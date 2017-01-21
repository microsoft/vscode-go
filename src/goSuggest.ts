/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { dirname, basename } from 'path';
import { getBinPath, parameters, parseFilePrelude, isPositionInString } from './util';
import { promptForMissingTool } from './goInstallTools';
import { listPackages, getTextEditForAddImport } from './goImport';

function vscodeKindFromGoCodeClass(kind: string): vscode.CompletionItemKind {
	switch (kind) {
		case 'const':
		case 'package':
		case 'type':
			return vscode.CompletionItemKind.Keyword;
		case 'func':
			return vscode.CompletionItemKind.Function;
		case 'var':
			return vscode.CompletionItemKind.Field;
		case 'import':
			return vscode.CompletionItemKind.Module;
	}
	return vscode.CompletionItemKind.Property; // TODO@EG additional mappings needed?
}

interface GoCodeSuggestion {
	class: string;
	name: string;
	type: string;
}

interface PackageInfo {
	name: string;
	path: string;
}

export class GoCompletionItemProvider implements vscode.CompletionItemProvider {

	private gocodeConfigurationComplete = false;
	private pkgsList: PackageInfo[] = [];

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]> {
		return this.provideCompletionItemsInternal(document, position, token, vscode.workspace.getConfiguration('go'));
	}

	public provideCompletionItemsInternal(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, config: vscode.WorkspaceConfiguration): Thenable<vscode.CompletionItem[]> {
		return this.ensureGoCodeConfigured().then(() => {
			return new Promise<vscode.CompletionItem[]>((resolve, reject) => {
				let filename = document.fileName;
				let lineText = document.lineAt(position.line).text;
				let lineTillCurrentPosition = lineText.substr(0, position.character);
				let autocompleteUnimportedPackages = config['autocompleteUnimportedPackages'] === true;

				if (lineText.match(/^\s*\/\//)) {
					return resolve([]);
				}

				let inString = isPositionInString(document, position);
				if (!inString && lineTillCurrentPosition.endsWith('\"')) {
					return resolve([]);
				}

				// get current word
				let wordAtPosition = document.getWordRangeAtPosition(position);
				let currentWord = '';
				if (wordAtPosition && wordAtPosition.start.character < position.character) {
					let word = document.getText(wordAtPosition);
					currentWord = word.substr(0, position.character - wordAtPosition.start.character);
				}

				if (currentWord.match(/^\d+$/)) {
					return resolve([]);
				}

				let offset = document.offsetAt(position);
				let inputText = document.getText();
				let includeUnimportedPkgs = autocompleteUnimportedPackages && !inString;

				return this.runGoCode(filename, inputText, offset, inString, position, lineText, currentWord, includeUnimportedPkgs).then(suggestions => {
					// If no suggestions and cursor is at a dot, then check if preceeding word is a package name
					// If yes, then import the package in the inputText and run gocode again to get suggestions
					if (suggestions.length === 0 && lineTillCurrentPosition.endsWith('.')) {

						let pkgPath = this.getPackagePathFromLine(lineTillCurrentPosition);
						if (pkgPath) {
							// Now that we have the package path, import it right after the "package" statement
							let {imports, pkg} = parseFilePrelude(vscode.window.activeTextEditor.document.getText());
							let posToAddImport = document.offsetAt(new vscode.Position(pkg.start + 1 , 0));
							let textToAdd = `import "${pkgPath}"\n`;
							inputText = inputText.substr(0, posToAddImport) +  textToAdd + inputText.substr(posToAddImport);
							offset += textToAdd.length;

							// Now that we have the package imported in the inputText, run gocode again
							return this.runGoCode(filename, inputText, offset, inString, position, lineText, currentWord, false).then(newsuggestions => {
								// Since the new suggestions are due to the package that we imported,
								// add additionalTextEdits to do the same in the actual document in the editor
								// We use additionalTextEdits instead of command so that 'useCodeSnippetsOnFunctionSuggest' feature continues to work
								newsuggestions.forEach(item => {
									item.additionalTextEdits = [getTextEditForAddImport(pkgPath)];
								});
								resolve(newsuggestions);
							});
						}
					}
					resolve(suggestions);
				});
			});
		});
	}

	private runGoCode(filename: string, inputText: string, offset: number, inString: boolean, position: vscode.Position, lineText: string, currentWord: string, includeUnimportedPkgs: boolean): Thenable<vscode.CompletionItem[]> {
		return new Promise<vscode.CompletionItem[]>((resolve, reject) => {
			let gocode = getBinPath('gocode');

			// Unset GOOS and GOARCH for the `gocode` process to ensure that GOHOSTOS and GOHOSTARCH
			// are used as the target operating system and architecture. `gocode` is unable to provide
			// autocompletion when the Go environment is configured for cross compilation.
			let env = Object.assign({}, process.env, { GOOS: '', GOARCH: '' });
			let stdout = '';
			let stderr = '';

			// Spawn `gocode` process
			let p = cp.spawn(gocode, ['-f=json', 'autocomplete', filename, 'c' + offset], { env });
			p.stdout.on('data', data => stdout += data);
			p.stderr.on('data', data => stderr += data);
			p.on('error', err => {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('gocode');
					return reject();
				}
				return reject(err);
			});
			p.on('close', code => {
				try {
					if (code !== 0) {
						return reject(stderr);
					}
					let results = <[number, GoCodeSuggestion[]]>JSON.parse(stdout.toString());
					let suggestions = [];
					let suggestionSet = new Set<string>();

					// 'Smart Snippet' for package clause
					// TODO: Factor this out into a general mechanism
					if (!inputText.match(/package\s+(\w+)/)) {
						let defaultPackageName =
							basename(filename) === 'main.go'
								? 'main'
								: basename(dirname(filename));
						let packageItem = new vscode.CompletionItem('package ' + defaultPackageName);
						packageItem.kind = vscode.CompletionItemKind.Snippet;
						packageItem.insertText = 'package ' + defaultPackageName + '\r\n\r\n';
						suggestions.push(packageItem);

					}
					if (results[1]) {
						for (let suggest of results[1]) {
							if (inString && suggest.class !== 'import') continue;
							let item = new vscode.CompletionItem(suggest.name);
							item.kind = vscodeKindFromGoCodeClass(suggest.class);
							item.detail = suggest.type;
							if (inString && suggest.class === 'import') {
								item.textEdit = new vscode.TextEdit(
									new vscode.Range(
										position.line,
										lineText.substring(0, position.character).lastIndexOf('"') + 1,
										position.line,
										position.character),
									suggest.name
								);
							}
							let conf = vscode.workspace.getConfiguration('go');
							if (conf.get('useCodeSnippetsOnFunctionSuggest') && suggest.class === 'func') {
								let params = parameters(suggest.type.substring(4));
								let paramSnippets = [];
								for (let i in params) {
									let param = params[i].trim();
									if (param) {
										param = param.replace('${', '\\${').replace('}', '\\}');
										paramSnippets.push('${' + param + '}');
									}
								}
								item.insertText = new vscode.SnippetString(suggest.name + '(' + paramSnippets.join(', ') + ')');
							}

							// Add same sortText to all suggestions from gocode so that they appear before the unimported packages
							item.sortText = 'a';
							suggestions.push(item);
							suggestionSet.add(item.label);
						};
					}

					// Add importable packages matching currentword to suggestions
					let importablePkgs = includeUnimportedPkgs ? this.getMatchingPackages(currentWord, suggestionSet) : [];
					suggestions = suggestions.concat(importablePkgs);

					resolve(suggestions);
				} catch (e) {
					reject(e);
				}
			});
			p.stdin.end(inputText);
		});
	}
	// TODO: Shouldn't lib-path also be set?
	private ensureGoCodeConfigured(): Thenable<void> {
		let pkgPromise = listPackages(true).then((pkgs: string[]) => {
				this.pkgsList = pkgs.map(pkg => {
					let index = pkg.lastIndexOf('/');
					let pkgName = index === -1 ? pkg : pkg.substr(index + 1);
					// pkgs from gopkg.in will be of the form gopkg.in/user/somepkg.v3
					if (pkg.match(/gopkg\.in\/.*\.v\d+/)) {
						pkgName = pkgName.substr(0, pkgName.lastIndexOf('.v'));
					}
					return {
						name: pkgName,
						path: pkg
					};
				});
			});
		let configPromise = new Promise<void>((resolve, reject) => {
			// TODO: Since the gocode daemon is shared amongst clients, shouldn't settings be
			// adjusted per-invocation to avoid conflicts from other gocode-using programs?
			if (this.gocodeConfigurationComplete) {
				return resolve();
			}
			let gocode = getBinPath('gocode');
			let autobuild = vscode.workspace.getConfiguration('go')['gocodeAutoBuild'];
			cp.execFile(gocode, ['set', 'propose-builtins', 'true'], {}, (err, stdout, stderr) => {
				cp.execFile(gocode, ['set', 'autobuild', autobuild], {}, (err, stdout, stderr) => {
					resolve();
				});
			});
		});
		return Promise.all([pkgPromise, configPromise]).then(() => {
			return Promise.resolve();
		}); ;
	}

	// Return importable packages that match given word as Completion Items
	private getMatchingPackages(word: string, suggestionSet: Set<string>): vscode.CompletionItem[] {
		if (!word) return [];
		let completionItems = this.pkgsList.filter((pkgInfo: PackageInfo) => {
			return pkgInfo.name.startsWith(word) && !suggestionSet.has(pkgInfo.name);
		}).map((pkgInfo: PackageInfo) => {
			let item = new vscode.CompletionItem(pkgInfo.name, vscode.CompletionItemKind.Keyword);
			item.detail = pkgInfo.path;
			item.documentation = 'Imports the package';
			item.insertText = pkgInfo.name;
			item.command = {
				title: 'Import Package',
				command: 'go.import.add',
				arguments: [pkgInfo.path]
			};
			// Add same sortText to the unimported packages so that they appear after the suggestions from gocode
			item.sortText = 'z';
			return item;
		});
		return completionItems;
	}

	// Given a line ending with dot, return the word preceeding the dot if it is a package name that can be imported
	private getPackagePathFromLine(line: string): string {
		let pattern = /(\w+)\.$/g;
		let wordmatches = pattern.exec(line);
		if (!wordmatches) {
			return;
		}

		let [_, pkgName] = wordmatches;
		// Word is isolated. Now check pkgsList for a match
		let matchingPackages = this.pkgsList.filter(pkgInfo => {
			return pkgInfo.name === pkgName;
		});

		if (matchingPackages && matchingPackages.length === 1) {
			return matchingPackages[0].path;
		}
	}
}
