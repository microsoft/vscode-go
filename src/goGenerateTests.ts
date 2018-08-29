/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');

import { getBinPath, getToolsEnvVars } from './util';
import { promptForMissingTool } from './goInstallTools';
import { GoDocumentSymbolProvider } from './goOutline';
import { outputChannel } from './goStatus';

const generatedWord = 'Generated ';

/**
 * If current active editor has a Go file, returns the editor.
 */
function checkActiveEditor(): vscode.TextEditor {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('Cannot generate unit tests. No editor selected.');
		return;
	}
	if (!editor.document.fileName.endsWith('.go')) {
		vscode.window.showInformationMessage('Cannot generate unit tests. File in the editor is not a Go file.');
		return;
	}
	if (editor.document.isDirty) {
		vscode.window.showInformationMessage('File has unsaved changes. Save and try again.');
		return;
	}
	return editor;
}

/**
 * Toggles between file in current active editor and the corresponding test file.
 */
export function toggleTestFile(): void {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('Cannot toggle test file. No editor selected.');
		return;
	}
	let currentFilePath = editor.document.fileName;
	if (!currentFilePath.endsWith('.go')) {
		vscode.window.showInformationMessage('Cannot toggle test file. File in the editor is not a Go file.');
		return;
	}
	let targetFilePath = '';
	if (currentFilePath.endsWith('_test.go')) {
		targetFilePath = currentFilePath.substr(0, currentFilePath.lastIndexOf('_test.go')) + '.go';
	} else {
		targetFilePath = currentFilePath.substr(0, currentFilePath.lastIndexOf('.go')) + '_test.go';
	}
	for (let doc of vscode.window.visibleTextEditors) {
		if (doc.document.fileName === targetFilePath) {
			vscode.commands.executeCommand('vscode.open', vscode.Uri.file(targetFilePath), doc.viewColumn);
			return;
		}
	}
	vscode.commands.executeCommand('vscode.open', vscode.Uri.file(targetFilePath));
}

export function generateTestCurrentPackage(): Thenable<boolean> {
	let editor = checkActiveEditor();
	if (!editor) {
		return;
	}
	return generateTests({ dir: path.dirname(editor.document.uri.fsPath) },
		vscode.workspace.getConfiguration('go', editor.document.uri));
}

export function generateTestCurrentFile(): Thenable<boolean> {
	let editor = checkActiveEditor();
	if (!editor) {
		return;
	}
	return generateTests({ dir: editor.document.uri.fsPath },
		vscode.workspace.getConfiguration('go', editor.document.uri));
}

export function generateTestCurrentFunction(): Thenable<boolean> {
	let editor = checkActiveEditor();
	if (!editor) {
		return;
	}

	return getFunctions(editor.document).then(functions => {
		let currentFunction: vscode.SymbolInformation;
		for (let func of functions) {
			let selection = editor.selection;
			if (selection && func.location.range.contains(selection.start)) {
				currentFunction = func;
				break;
			}
		};
		if (!currentFunction) {
			vscode.window.showInformationMessage('No function found at cursor.');
			return Promise.resolve(false);
		}
		let funcName = currentFunction.name;
		if (funcName.includes('.')) {
			funcName = funcName.split('.')[1];
		}
		return generateTests({ dir: editor.document.uri.fsPath, func: funcName },
			vscode.workspace.getConfiguration('go', editor.document.uri));
	});
}

/**
 * Input to goTests.
 */
interface Config {
	/**
	 * The working directory for `gotests`.
	 */
	dir: string;
	/**
	 * Specific function names to generate tests squeleton.
	 */
	func?: string;
}

function generateTests(conf: Config, goConfig: vscode.WorkspaceConfiguration): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		let cmd = getBinPath('gotests');
		let args = ['-w'];
		let goGenerateTestsFlags: string[] = goConfig['genTestsFlags'] || [];

		goGenerateTestsFlags.forEach(flag => {
			args.push(flag);
		});

		if (conf.func) {
			args = args.concat(['-only', `^${conf.func}$`, conf.dir]);
		} else {
			args = args.concat(['-all', conf.dir]);
		}

		cp.execFile(cmd, args, { env: getToolsEnvVars() }, (err, stdout, stderr) => {
			outputChannel.appendLine('Generating Tests: ' + cmd + ' ' + args.join(' '));

			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('gotests');
					return resolve(false);
				}
				if (err) {
					console.log(err);
					outputChannel.appendLine(err.message);
					return reject('Cannot generate test due to errors');
				}

				let message = stdout;
				let testsGenerated = false;

				// Expected stdout is of the format "Generated TestMain\nGenerated Testhello\n"
				if (stdout.startsWith(generatedWord)) {
					let lines = stdout.split('\n').filter(element => {
						return element.startsWith(generatedWord);
					}).map((element) => {
						return element.substr(generatedWord.length);
					});
					message = `Generated ${lines.join(', ')}`;
					testsGenerated = true;
				}

				vscode.window.showInformationMessage(message);
				outputChannel.append(message);
				if (testsGenerated) {
					toggleTestFile();
				}

				return resolve(true);
			} catch (e) {
				vscode.window.showInformationMessage(e.msg);
				outputChannel.append(e.msg);
				reject(e);
			}
		});
	});
}

function getFunctions(doc: vscode.TextDocument): Thenable<vscode.SymbolInformation[]> {
	let documentSymbolProvider = new GoDocumentSymbolProvider();
	return documentSymbolProvider
		.provideDocumentSymbols(doc, null)
		.then(symbols =>
			symbols.filter(sym =>
				sym.kind === vscode.SymbolKind.Function)
		);
}
