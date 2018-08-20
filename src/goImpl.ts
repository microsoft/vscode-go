/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { dirname, join } from 'path';
import { getBinPath, getToolsEnvVars, getCurrentGoPath } from './util';
import { promptForMissingTool } from './goInstallTools';
import { askUserForImport } from './goImport';
import { GoDocumentSymbolProvider } from './goOutline';
import { getAllPackages } from './goPackages';


export function implCursor() {
	let editor = vscode.window.activeTextEditor;
	let cursor = editor.selection;
	let typeName = '';
	let inputValue = '';
	if (!cursor.isEmpty) {
		typeName = editor.document.getText(cursor).trim();
		if (typeName.length > 0) {
			inputValue = typeName[0] + ' *' + typeName;
		}
	}
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		value: inputValue,
		placeHolder: 'f *File io.Closer',
		prompt: 'Enter receiver type name and interface(blank for manual search) to implement.You may choose the position of insertion before "Enter"'
	}).then(implInput => {
		if (typeof implInput === 'undefined') {
			return;
		}
		let inputArgs = implInput.split(' ');
		if (!inputArgs) {
			return;
		}
		let typeArg = '';
		let interfaceArg = '';
		if (inputArgs.length === 1) {
			// assume the only arg here be the type name,
			// use its first character as reciever variable
			// and let user search the interface arg
			typeArg = inputArgs[0][0].toLowerCase() + ' ' + ((inputArgs[0].startsWith('*')) ? inputArgs[0] : ('*' + inputArgs[0]));
		} else if (inputArgs.length === 2 ) {
			if (inputArgs[0].startsWith('*')) {
				// if the first arg starts with "*",
				// assume it as type name and the second one as interface name
				typeArg = inputArgs[0][0].toLowerCase() + inputArgs[0];
				interfaceArg = inputArgs[1];
			} else if (inputArgs[1].startsWith('*')) {
				// if the second arg starts with "*"
				// assume it as type name and the first one as reciever name,
				// let user search manually for interface name
				typeArg = inputArgs[0] + inputArgs[1];
			} else {
				vscode.window.showInformationMessage('Cannot stub interface: wrong input arguments');
				return;
			}

		} else if (inputArgs.length === 3) {
			// all three args for impl is provided
			typeArg = inputArgs[0] + ' ' + inputArgs[1];
			interfaceArg = inputArgs[2];
		} else {
			vscode.window.showInformationMessage('Cannot stub interface: too many input arguments');
			return;
		}
		if (interfaceArg.length === 0) {
			// let user search manually for interface name
			getSelectedInterface().then( seletedInterface => {
				if (seletedInterface.length === 0) {
					vscode.window.showInformationMessage('Cannot stub interface: no interface selected');
					return;
				} else {
					interfaceArg = seletedInterface;
					if (interfaceArg.length === 0) {
						vscode.window.showInformationMessage('Cannot stub interface: no interface selected');
						return;
					}
				}
				// in case the user relocate the cursor
				cursor = vscode.window.activeTextEditor.selection;
				runGoImpl([typeArg, interfaceArg], cursor.start);
			});
		} else {
			let pkgInterface = interfaceArg.split('.');
			let autoPath = autoCompletePath(pkgInterface[0]);
			if (!autoPath.length) {
				askUserForImport().then(selected => {
					interfaceArg = selected + '.' + pkgInterface[1];
					runGoImpl([typeArg, interfaceArg], cursor.start);
				});
			} else {
				interfaceArg = autoPath + '.' + pkgInterface[1];
				cursor = vscode.window.activeTextEditor.selection;
				runGoImpl([typeArg, interfaceArg], cursor.start);
			}
		}
	});
}

function runGoImpl(args: string[], insertPos: vscode.Position) {
	let goimpl = getBinPath('impl');
	let p = cp.execFile(goimpl, args, { env: getToolsEnvVars(), cwd: dirname(vscode.window.activeTextEditor.document.fileName) }, (err, stdout, stderr) => {
		if (err && (<any>err).code === 'ENOENT') {
			promptForMissingTool('impl');
			return;
		}

		if (err) {
			vscode.window.showInformationMessage(`Cannot stub interface: ${stderr}`);
			return;
		}

		vscode.window.activeTextEditor.edit(editBuilder => {
			editBuilder.insert(insertPos, stdout);
		});
	});
	if (p.pid) {
		p.stdin.end();
	}
}

function getSelectedInterface(): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		//  show package list
		getAllPackages().then(pkgMap => {
		const pkgs: string[] = Array.from(pkgMap.keys());
		if (pkgs.length === 0) {
			vscode.window.showErrorMessage('Could not find packages. Ensure `gopkgs -format {{.Name}};{{.ImportPath}}` runs successfully.');
			resolve('');
		}
		vscode
			.window
			.showQuickPick(pkgs.sort(), { placeHolder: 'Select a package to browse' })
			.then(pkgFromDropdown => {
				if (!pkgFromDropdown) {
					resolve('');
				}
				getInterfaceFromPkg(pkgFromDropdown).then(selectedInterface => {
					if (selectedInterface.length === 0) {
						resolve('');
					}
					resolve(pkgFromDropdown + '.' + selectedInterface);
				});
			});
		});
	});
}

/**
 * Returns interface from a package passed in
 * @param pkg. Used to verify from which package to get interface
 * @returns interface name list in the package
 * (ATTENTION: names of symbols which match vscode.SymbolKind.Interface,
 * struct may also be matched, can be enhanced here)
 */
function getInterfaceFromPkg(pkg: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const goRuntimePath = getBinPath('go');
		if (!goRuntimePath) {
			vscode.window.showErrorMessage('Could not locate Go path. Make sure you have Go installed');
			resolve('');
		}
		const env = Object.assign({}, process.env, { GOPATH: getCurrentGoPath() });
		cp.execFile(goRuntimePath, ['list', '-f', '{{.Dir}}:{{.GoFiles}}:{{.TestGoFiles}}:{{.XTestGoFiles}}', pkg], { env }, (err, stdout, stderr) => {
			if (!stdout || stdout.indexOf(':') === -1) {
				resolve('');
			}
			let matches = stdout && stdout.match(/(.*):\[(.*)\]:\[(.*)\]:\[(.*)\]/);
			if (matches) {
				let dir = matches[1];
				let files = matches[2] ? matches[2].split(' ') : [];
				let testfiles = matches[3] ? matches[3].split(' ') : [];
				let xtestfiles = matches[4] ? matches[4].split(' ') : [];
				files = files.concat(testfiles);
				files = files.concat(xtestfiles);
				if (files.length === 0) {
					vscode.window.showInformationMessage('no file in selected package');
					resolve('');
				}
				vscode.window.showQuickPick(files,
					{ placeHolder: `Below are files from ${pkg}` }
				).then(selectedFile => {
					if (!selectedFile) {
						resolve('');
					}
					let interfaceList = [];
					vscode.workspace.openTextDocument(join(dir, selectedFile)).then(document => {
						getInterfaceFromDoc(document).then(syms => {
							if (syms.length === 0) {
								vscode.window.showInformationMessage('no interface in selected file');
								resolve('');
							}
							interfaceList =  interfaceList.concat(syms.map(interfaceSymbol => interfaceSymbol.name));
							vscode.window.showQuickPick(interfaceList,
								{ignoreFocusOut: true,
								placeHolder: `Below are interfaces from ${selectedFile}`}
							).then(selected => {
								if (!selected) {
									resolve('');
								}
								resolve(selected);
							});
						});
					});
				});
			}
		});
	});
}

function getInterfaceFromDoc(doc: vscode.TextDocument): Thenable<vscode.SymbolInformation[]> {
	let documentSymbolProvider = new GoDocumentSymbolProvider();
	return documentSymbolProvider
		.provideDocumentSymbols(doc, null)
		.then(symbols =>
			symbols.filter(sym => {
				return sym.kind === vscode.SymbolKind.Interface;
			}));
}

function autoCompletePath(shortPkgName: string): string {
		// search 'import' in the file first, use regex
		let currentDocument = vscode.window.activeTextEditor.document;
		let importList: string[] = [];
		let completePath = '';
		const importRegexp = /(import\s*\(\s*(\"[\w./]+\"\s*)+\))|(import\s*\"[\w./]+\")/;
		let matches = importRegexp.exec(currentDocument.getText());
		if (!matches) {
			return '';
		} else if (matches[0].indexOf('(') !== -1) {
			const importStart = matches[0].indexOf('(');
			const importEnd = matches[0].indexOf(')');
			importList = matches[0].slice(importStart + 1, importEnd).trim()
			.split(/\s+/g).map(ImportPkg => ImportPkg.slice(1, -1));
		} else {
			const importStart = matches[0].indexOf('"');
			const importEnd = matches[0].indexOf('"');
			importList.push(matches[0].slice(importStart + 1, importEnd));
		}
		importList.forEach(ImportPkg => {
			if (ImportPkg.endsWith(shortPkgName)) {
				completePath = ImportPkg;
			}
		});
		return completePath;
}