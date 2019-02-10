/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import path = require('path');
import vscode = require('vscode');
import cp = require('child_process');
import { getCurrentGoPath, getBinPath, getParametersAndReturnType, parseFilePrelude, isPositionInString, goKeywords, getToolsEnvVars, guessPackageNameFromFile, goBuiltinTypes, byteOffsetAt, runGodoc } from './util';
import { getCurrentGoWorkspaceFromGOPATH } from './goPath';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';
import { getTextEditForAddImport } from './goImport';
import { getImportablePackages } from './goPackages';
import { isModSupported } from './goModules';

function vscodeKindFromGoCodeClass(kind: string, type: string): vscode.CompletionItemKind {
	switch (kind) {
		case 'const':
			return vscode.CompletionItemKind.Constant;
		case 'package':
			return vscode.CompletionItemKind.Module;
		case 'type':
			switch (type) {
				case 'struct':
					return vscode.CompletionItemKind.Class;
				case 'interface':
					return vscode.CompletionItemKind.Interface;
			}
			return vscode.CompletionItemKind.Struct;
		case 'func':
			return vscode.CompletionItemKind.Function;
		case 'var':
			return vscode.CompletionItemKind.Variable;
		case 'import':
			return vscode.CompletionItemKind.Module;
	}
	return vscode.CompletionItemKind.Property; // TODO@EG additional mappings needed?
}

interface GoCodeSuggestion {
	class: string;
	package?: string;
	name: string;
	type: string;
	receiver?: string;
}

class ExtendedCompletionItem extends vscode.CompletionItem {
	package?: string;
	receiver?: string;
	fileName: string;
}

const lineCommentFirstWordRegex = /^\s*\/\/\s+[\S]*$/;
const exportedMemberRegex = /(const|func|type|var)(\s+\(.*\))?\s+([A-Z]\w*)/;
const gocodeNoSupportForgbMsgKey = 'dontshowNoSupportForgb';

export class GoCompletionItemProvider implements vscode.CompletionItemProvider, vscode.Disposable {
	private pkgsList = new Map<string, string>();
	private killMsgShown: boolean = false;
	private setGocodeOptions: boolean = true;
	private isGoMod: boolean = false;
	private globalState: vscode.Memento;
	private previousFile: string;
	private previousFileDir: string;
	private gocodeFlags: string[];
	private excludeDocs: boolean = false;

	constructor(globalState?: vscode.Memento) {
		this.globalState = globalState;
	}

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionList> {
		return this.provideCompletionItemsInternal(document, position, token, vscode.workspace.getConfiguration('go', document.uri)).then(result => {
			if (!result) {
				return new vscode.CompletionList([], false);
			}
			if (Array.isArray(result)) {
				return new vscode.CompletionList(result, false);
			}
			return result;
		});
	}

	public resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
		if (!(item instanceof ExtendedCompletionItem)
		|| item.kind === vscode.CompletionItemKind.Module
		|| this.excludeDocs) {
			return;
		}

		if (typeof item.package === 'undefined') {
			promptForUpdatingTool('gocode');
			return;
		}

		return runGodoc(path.dirname(item.fileName), item.package || path.dirname(item.fileName), item.receiver, item.label, token).then(doc => {
			item.documentation = new vscode.MarkdownString(doc);
			return item;
		}).catch(err => {
			console.log(err);
			return item;
		});
	}

	public provideCompletionItemsInternal(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, config: vscode.WorkspaceConfiguration): Thenable<vscode.CompletionItem[] | vscode.CompletionList> {
		this.excludeDocs = false;
		this.gocodeFlags = ['-f=json'];
		if (Array.isArray(config['gocodeFlags'])) {
			this.gocodeFlags.push(...config['gocodeFlags']);
		}

		return this.ensureGoCodeConfigured(document.uri, config).then(() => {
			return new Promise<vscode.CompletionItem[] | vscode.CompletionList>((resolve, reject) => {
				let filename = document.fileName;
				let lineText = document.lineAt(position.line).text;
				let lineTillCurrentPosition = lineText.substr(0, position.character);
				let autocompleteUnimportedPackages = config['autocompleteUnimportedPackages'] === true && !lineText.match(/^(\s)*(import|package)(\s)+/);

				// triggering completions in comments on exported members
				if (lineCommentFirstWordRegex.test(lineTillCurrentPosition) && position.line + 1 < document.lineCount) {
					let nextLine = document.lineAt(position.line + 1).text.trim();
					let memberType = nextLine.match(exportedMemberRegex);
					let suggestionItem: vscode.CompletionItem;
					if (memberType && memberType.length === 4) {
							suggestionItem = new vscode.CompletionItem(memberType[3], vscodeKindFromGoCodeClass(memberType[1], ''));
					}
					return resolve(suggestionItem ? [suggestionItem] : []);
				}

				// prevent completion when typing in a line comment that doesnt start from the beginning of the line
				const commentIndex = lineText.indexOf('//');

				if (commentIndex >= 0 && position.character > commentIndex) {
					const commentPosition = new vscode.Position(position.line, commentIndex);
					const isCommentInString = isPositionInString(document, commentPosition);

					if (!isCommentInString) {
						return resolve([]);
					}
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

				let offset = byteOffsetAt(document, position);
				let inputText = document.getText();
				let includeUnimportedPkgs = autocompleteUnimportedPackages && !inString;

				return this.runGoCode(document, filename, inputText, offset, inString, position, lineText, currentWord, includeUnimportedPkgs, config).then(suggestions => {
					// gocode does not suggest keywords, so we have to do it
					if (currentWord.length > 0) {
						goKeywords.forEach(keyword => {
							if (keyword.startsWith(currentWord)) {
								suggestions.push(new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword));
							}
						});
					}

					// If no suggestions and cursor is at a dot, then check if preceeding word is a package name
					// If yes, then import the package in the inputText and run gocode again to get suggestions
					if ((!suggestions || suggestions.length === 0) && lineTillCurrentPosition.endsWith('.')) {

						let pkgPath = this.getPackagePathFromLine(lineTillCurrentPosition);
						if (pkgPath.length === 1) {
							// Now that we have the package path, import it right after the "package" statement
							let { imports, pkg } = parseFilePrelude(vscode.window.activeTextEditor.document.getText());
							let posToAddImport = document.offsetAt(new vscode.Position(pkg.start + 1, 0));
							let textToAdd = `import "${pkgPath[0]}"\n`;
							inputText = inputText.substr(0, posToAddImport) + textToAdd + inputText.substr(posToAddImport);
							offset += textToAdd.length;

							// Now that we have the package imported in the inputText, run gocode again
							return this.runGoCode(document, filename, inputText, offset, inString, position, lineText, currentWord, false, config).then(newsuggestions => {
								// Since the new suggestions are due to the package that we imported,
								// add additionalTextEdits to do the same in the actual document in the editor
								// We use additionalTextEdits instead of command so that 'useCodeSnippetsOnFunctionSuggest' feature continues to work
								newsuggestions.forEach(item => {
									item.additionalTextEdits = getTextEditForAddImport(pkgPath[0]);
								});
								resolve(newsuggestions);
							}, reject);
						}
						if (pkgPath.length > 1) {
							pkgPath.forEach(pkg => {
								let item = new vscode.CompletionItem(
									`${lineTillCurrentPosition.replace('.', '').trim()} (${pkg})`,
									vscode.CompletionItemKind.Module
								);
								item.additionalTextEdits = getTextEditForAddImport(pkg);
								item.insertText = '';
								item.detail = pkg;
								item.command = {
									title: 'Trigger Suggest',
									command: 'editor.action.triggerSuggest'
								};
								suggestions.push(item);
							});
							resolve(new vscode.CompletionList(suggestions, true));
						}
					}
					resolve(suggestions);
				}, reject);
			});
		});
	}

	public dispose() {
		let gocodeName = this.isGoMod ? 'gocode-gomod' : 'gocode';
		let gocode = getBinPath(gocodeName);
		if (path.isAbsolute(gocode)) {
			cp.spawn(gocode, ['close'], { env: getToolsEnvVars() });
		}
	}

	private runGoCode(document: vscode.TextDocument, filename: string, inputText: string, offset: number, inString: boolean, position: vscode.Position, lineText: string, currentWord: string, includeUnimportedPkgs: boolean, config: vscode.WorkspaceConfiguration): Thenable<vscode.CompletionItem[]> {
		return new Promise<vscode.CompletionItem[]>((resolve, reject) => {
			let gocodeName = this.isGoMod ? 'gocode-gomod' : 'gocode';
			let gocode = getBinPath(gocodeName);
			if (!path.isAbsolute(gocode)) {
				promptForMissingTool(gocodeName);
				return reject();
			}

			let env = getToolsEnvVars();
			let stdout = '';
			let stderr = '';

			// stamblerre/gocode does not support -unimported-packages flags.
			if (this.isGoMod) {
				const idx = this.gocodeFlags.indexOf('-unimported-packages');
				if (idx >= 0) {
					this.gocodeFlags.splice(idx, 1);
				}
			}

			// -exclude-docs is something we use internally and is not related to gocode
			const idx = this.gocodeFlags.indexOf('-exclude-docs');
			if (idx >= 0) {
				this.gocodeFlags.splice(idx, 1);
				this.excludeDocs = true;
			}

			// Spawn `gocode` process
			let p = cp.spawn(gocode, [...this.gocodeFlags, 'autocomplete', filename, '' + offset], { env });
			p.stdout.on('data', data => stdout += data);
			p.stderr.on('data', data => stderr += data);
			p.on('error', err => {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool(gocodeName);
					return reject();
				}
				return reject(err);
			});
			p.on('close', code => {
				try {
					if (code !== 0) {
						if (stderr.indexOf('rpc: can\'t find service Server.AutoComplete') > -1 && !this.killMsgShown) {
							vscode.window.showErrorMessage('Auto-completion feature failed as an older gocode process is still running. Please kill the running process for gocode and try again.');
							this.killMsgShown = true;
						}
						if (stderr.startsWith('flag provided but not defined:')) {
							promptForUpdatingTool(gocodeName);
						}
						return reject();
					}
					let results = <[number, GoCodeSuggestion[]]>JSON.parse(stdout.toString());
					let suggestions: vscode.CompletionItem[] = [];
					let suggestionSet = new Set<string>();

					let wordAtPosition = document.getWordRangeAtPosition(position);

					if (results && results[1]) {
						for (let suggest of results[1]) {
							if (inString && suggest.class !== 'import') continue;
							let item = new ExtendedCompletionItem(suggest.name);
							item.kind = vscodeKindFromGoCodeClass(suggest.class, suggest.type);
							item.package = suggest.package;
							item.receiver = suggest.receiver;
							item.fileName = document.fileName;
							item.detail = suggest.type;
							if (suggest.class === 'package') {
								const possiblePackageImportPaths = this.getPackageImportPath(item.label);
								if (possiblePackageImportPaths.length === 1) {
									item.detail = possiblePackageImportPaths[0];
								}
							}
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
							if ((config['useCodeSnippetsOnFunctionSuggest'] || config['useCodeSnippetsOnFunctionSuggestWithoutType'])
								&& (
									(suggest.class === 'func' && lineText.substr(position.character, 2) !== '()') // Avoids met() -> method()()
									|| (
										suggest.class === 'var'
										&& suggest.type.startsWith('func(')
										&& lineText.substr(position.character, 1) !== ')' // Avoids snippets when typing params in a func call
										&& lineText.substr(position.character, 1) !== ',' // Avoids snippets when typing params in a func call
									))) {
								let { params, returnType } = getParametersAndReturnType(suggest.type.substring(4));
								let paramSnippets = [];
								for (let i = 0; i < params.length; i++) {
									let param = params[i].trim();
									if (param) {
										param = param.replace('${', '\\${').replace('}', '\\}');
										if (config['useCodeSnippetsOnFunctionSuggestWithoutType']) {
											if (param.includes(' ')) {
												// Separate the variable name from the type
												param = param.substr(0, param.indexOf(' '));
											}
										}
										paramSnippets.push('${' + (i + 1) + ':' + param + '}');
									}
								}
								item.insertText = new vscode.SnippetString(suggest.name + '(' + paramSnippets.join(', ') + ')');
							}
							if (config['useCodeSnippetsOnFunctionSuggest'] && suggest.class === 'type' && suggest.type.startsWith('func(')) {
								let { params, returnType } = getParametersAndReturnType(suggest.type.substring(4));
								let paramSnippets = [];
								for (let i = 0; i < params.length; i++) {
									let param = params[i].trim();
									if (param) {
										param = param.replace('${', '\\${').replace('}', '\\}');
										if (!param.includes(' ')) {
											// If we don't have an argument name, we need to create one
											param = 'arg' + (i + 1) + ' ' + param;
										}
										let arg = param.substr(0, param.indexOf(' '));
										paramSnippets.push('${' + (i + 1) + ':' + arg + '}' + param.substr(param.indexOf(' '), param.length));
									}
								}
								item.insertText = new vscode.SnippetString(suggest.name + '(func(' + paramSnippets.join(', ') + ') {\n	$' + (params.length + 1) + '\n})' + returnType);
							}

							if (wordAtPosition && wordAtPosition.start.character === 0 &&
								suggest.class === 'type' && !goBuiltinTypes.has(suggest.name)) {
								let auxItem = new vscode.CompletionItem(suggest.name + ' method', vscode.CompletionItemKind.Snippet);
								auxItem.label = 'func (*' + suggest.name + ')';
								auxItem.filterText = suggest.name;
								auxItem.detail = 'Method snippet';
								auxItem.sortText = 'b';
								let prefix = 'func (' + suggest.name[0].toLowerCase() + ' *' + suggest.name + ')';
								let snippet = prefix + ' ${1:methodName}(${2}) ${3} \{\n\t$0\n\}';
								auxItem.insertText = new vscode.SnippetString(snippet);
								suggestions.push(auxItem);
							}

							// Add same sortText to all suggestions from gocode so that they appear before the unimported packages
							item.sortText = 'a';
							suggestions.push(item);
							suggestionSet.add(item.label);
						}
					}

					// Add importable packages matching currentword to suggestions
					if (includeUnimportedPkgs) {
						suggestions = suggestions.concat(this.getMatchingPackages(document, currentWord, suggestionSet));
					}

					// 'Smart Snippet' for package clause
					// TODO: Factor this out into a general mechanism
					if (!inputText.match(/package\s+(\w+)/)) {
						return guessPackageNameFromFile(filename).then((pkgNames: string[]) => {
							pkgNames.forEach(pkgName => {
								let packageItem = new vscode.CompletionItem('package ' + pkgName);
								packageItem.kind = vscode.CompletionItemKind.Snippet;
								packageItem.insertText = 'package ' + pkgName + '\r\n\r\n';
								suggestions.push(packageItem);
							});
							resolve(suggestions);
						}, () => resolve(suggestions));
					}

					resolve(suggestions);
				} catch (e) {
					reject(e);
				}
			});
			if (p.pid) {
				p.stdin.end(inputText);
			}
		});
	}
	// TODO: Shouldn't lib-path also be set?
	private ensureGoCodeConfigured(fileuri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration): Thenable<void> {
		const currentFile = fileuri.fsPath;
		let checkModSupport = Promise.resolve(this.isGoMod);
		if (this.previousFile !== currentFile && this.previousFileDir !== path.dirname(currentFile)) {
			this.previousFile = currentFile;
			this.previousFileDir = path.dirname(currentFile);
			checkModSupport = isModSupported(fileuri).then(result => this.isGoMod = result);
		}
		let setPkgsList = getImportablePackages(currentFile, true).then(pkgMap => { this.pkgsList = pkgMap; });

		if (!this.setGocodeOptions) {
			return Promise.all([checkModSupport, setPkgsList]).then(() => { return; });
		}

		let setGocodeProps = new Promise<void>((resolve, reject) => {
			let gocode = getBinPath('gocode');
			let env = getToolsEnvVars();

			cp.execFile(gocode, ['set'], { env }, (err, stdout, stderr) => {
				if (err && stdout.startsWith('gocode: unknown subcommand:')) {
					if (goConfig['gocodePackageLookupMode'] === 'gb' && this.globalState && !this.globalState.get(gocodeNoSupportForgbMsgKey)) {
						vscode.window.showInformationMessage('The go.gocodePackageLookupMode setting for gb will not be honored as github.com/mdempskey/gocode doesnt support it yet.', 'Don\'t show again').then(selected => {
							if (selected === 'Don\'t show again') {
								this.globalState.update(gocodeNoSupportForgbMsgKey, true);
							}
						});
					}
					this.setGocodeOptions = false;
					return resolve();
				}

				const existingOptions = stdout.split(/\r\n|\n/);
				const optionsToSet: string[][] = [];
				const setOption = () => {
					const [name, value] = optionsToSet.pop();
					cp.execFile(gocode, ['set', name, value], { env }, (err, stdout, stderr) => {
						if (optionsToSet.length) {
							setOption();
						} else {
							resolve();
						}
					});
				};

				if (existingOptions.indexOf('propose-builtins true') === -1) {
					optionsToSet.push(['propose-builtins', 'true']);
				}
				if (existingOptions.indexOf(`autobuild ${goConfig['gocodeAutoBuild']}`) === -1) {
					optionsToSet.push(['autobuild', goConfig['gocodeAutoBuild']]);
				}
				if (existingOptions.indexOf(`package-lookup-mode ${goConfig['gocodePackageLookupMode']}`) === -1) {
					optionsToSet.push(['package-lookup-mode', goConfig['gocodePackageLookupMode']]);
				}
				if (!optionsToSet.length) {
					return resolve();
				}

				setOption();
			});
		});

		return Promise.all([setPkgsList, setGocodeProps, checkModSupport]).then(() => {
			return;
		});
	}

	// Return importable packages that match given word as Completion Items
	private getMatchingPackages(document: vscode.TextDocument, word: string, suggestionSet: Set<string>): vscode.CompletionItem[] {
		if (!word) return [];

		const cwd = path.dirname(document.fileName);
		const goWorkSpace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), cwd);
		const workSpaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		const currentPkgRootPath = (workSpaceFolder ? workSpaceFolder.uri.path : cwd).slice(goWorkSpace.length + 1);

		let completionItems: any[] = [];
		this.pkgsList.forEach((pkgName: string, pkgPath: string) => {
			if (pkgName.startsWith(word) && !suggestionSet.has(pkgName)) {

				let item = new vscode.CompletionItem(pkgName, vscode.CompletionItemKind.Keyword);
				item.detail = pkgPath;
				item.documentation = 'Imports the package';
				item.insertText = pkgName;
				item.command = {
					title: 'Import Package',
					command: 'go.import.add',
					arguments: [pkgPath]
				};
				item.kind = vscode.CompletionItemKind.Module;

				// Unimported packages should appear after the suggestions from gocode
				const isStandardPackage = !item.detail.includes('.');
				item.sortText = isStandardPackage ? 'za' : pkgPath.startsWith(currentPkgRootPath) ? 'zb' : 'zc';
				completionItems.push(item);
			}
		});

		return completionItems;
	}

	// Given a line ending with dot, return the import paths of packages that match with the word preceeding the dot
	private getPackagePathFromLine(line: string): string[] {
		let pattern = /(\w+)\.$/g;
		let wordmatches = pattern.exec(line);
		if (!wordmatches) {
			return [];
		}

		let [_, pkgNameFromWord] = wordmatches;
		// Word is isolated. Now check pkgsList for a match
		return this.getPackageImportPath(pkgNameFromWord);
	}

	/**
	 * Returns import path for given package. Since there can be multiple matches,
	 * this returns an array of matches
	 * @param input Package name
	 */
	private getPackageImportPath(input: string): string[] {
		let matchingPackages: any[] = [];
		this.pkgsList.forEach((pkgName: string, pkgPath: string) => {
			if (input === pkgName) {
				matchingPackages.push(pkgPath);
			}
		});
		return matchingPackages;
	}
}
