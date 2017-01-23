/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import util = require('util');

import { getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';
import { GoDocumentSymbolProvider } from './goOutline';

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
	vscode.commands.executeCommand('vscode.open', vscode.Uri.file(targetFilePath));
}

export function generateTestCurrentPackage(): Thenable<boolean> {
	let editor = checkActiveEditor();
	if (!editor) {
		return;
	}
	let dir = path.dirname(editor.document.uri.fsPath);
	return generateTests({ dir: dir });
}

export function generateTestCurrentFile(): Thenable<boolean> {
	let editor = checkActiveEditor();
	if (!editor) {
		return;
	}
	let file = editor.document.uri.fsPath;
	return generateTests({ dir: file });
}

export function generateTestCurrentFunction(): Thenable<boolean> {
	let editor = checkActiveEditor();
	if (!editor) {
		return;
	}
	let file = editor.document.uri.fsPath;
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
			vscode.window.setStatusBarMessage('No function found at cursor.', 5000);
			return;
		}
		let funcName = currentFunction.name;
		if (funcName.includes('.')) {
			funcName = funcName.split('.')[1];
		}
		return generateTests({ dir: file, func: funcName });
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

function generateTests(conf: Config): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		let cmd = getBinPath('gotests');
		let args;
		if (conf.func) {
			args = ['-w', '-only', conf.func, conf.dir];
		} else {
			args = ['-w', '-all', conf.dir];
		}
		cp.execFile(cmd, args, {}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('gotests');
					return resolve(false);
				}
				if (err) {
					console.log(err);
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
				if (testsGenerated) {
					toggleTestFile();
				}

				return resolve(true);
			} catch (e) {
				vscode.window.showInformationMessage(e.msg);
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
