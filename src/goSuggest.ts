/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { dirname, basename } from 'path';
import { getBinPath } from './goPath';
import { parameters } from './util';

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
	}
	return vscode.CompletionItemKind.Property; // TODO@EG additional mappings needed?
}

interface GoCodeSuggestion {
	class: string;
	name: string;
	type: string;
}

export class GoCompletionItemProvider implements vscode.CompletionItemProvider {

	private gocodeConfigurationComplete = false;

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]> {
		return this.ensureGoCodeConfigured().then(() => {
			return new Promise<vscode.CompletionItem[]>((resolve, reject) => {
				let filename = document.fileName;

				if (document.lineAt(position.line).text.match(/^\s*\/\//)) {
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
				let gocode = getBinPath('gocode');

				// Unset GOOS and GOARCH for the `gocode` process to ensure that GOHOSTOS and GOHOSTARCH 
				// are used as the target operating system and architecture. `gocode` is unable to provide 
				// autocompletion when the Go environment is configured for cross compilation.
				let env = Object.assign({}, process.env, { GOOS: '', GOARCH: '' });

				// Spawn `gocode` process
				let p = cp.execFile(gocode, ['-f=json', 'autocomplete', filename, 'c' + offset], { env }, (err, stdout, stderr) => {
					try {
						if (err && (<any>err).code === 'ENOENT') {
							vscode.window.showInformationMessage('The "gocode" command is not available.  Use "go get -u github.com/nsf/gocode" to install.');
						}
						if (err) return reject(err);
						let results = <[number, GoCodeSuggestion[]]>JSON.parse(stdout.toString());
						if (!results[1]) {
							// 'Smart Snippet' for package clause
							// TODO: Factor this out into a general mechanism
							if (!document.getText().match(/package\s+(\w+)/)) {
								let defaultPackageName =
									basename(document.fileName) === 'main.go'
										? 'main'
										: basename(dirname(document.fileName));
								let packageItem = new vscode.CompletionItem('package ' + defaultPackageName);
								packageItem.kind = vscode.CompletionItemKind.Snippet;
								packageItem.insertText = 'package ' + defaultPackageName + '\r\n\r\n';
								return resolve([packageItem]);
							}
							return resolve([]);
						}
						let suggestions = results[1].map(suggest => {
							let item = new vscode.CompletionItem(suggest.name);
							item.kind = vscodeKindFromGoCodeClass(suggest.class);
							item.detail = suggest.type;
							let conf = vscode.workspace.getConfiguration('go');
							if (conf.get('useCodeSnippetsOnFunctionSuggest') && suggest.class === 'func') {
								let params = parameters(suggest.type.substring(4));
								let paramSnippets = [];
								for (let i in params) {
									let param = params[i].trim();
									if (param) {
										param = param.replace('{', '\\{').replace('}', '\\}');
										paramSnippets.push('{{' + param + '}}');
									}
								}
								item.insertText = suggest.name + '(' + paramSnippets.join(', ') + '){{}}';
							}
							return item;
						});
						resolve(suggestions);
					} catch (e) {
						reject(e);
					}
				});
				p.stdin.end(document.getText());
			});
		});
	}

	private ensureGoCodeConfigured(): Thenable<void> {
		return new Promise<void>((resolve, reject) => {
			if (this.gocodeConfigurationComplete) {
				return resolve();
			}
			let gocode = getBinPath('gocode');
			cp.execFile(gocode, ['set', 'propose-builtins', 'true'], {}, (err, stdout, stderr) => {
				cp.execFile(gocode, ['set', 'autobuild', 'true'], {}, (err, stdout, stderr) => {
					resolve();
				});
			});
		});
	}
}