/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import util = require('util');

import { getBinPath } from './goPath';
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
 * Opens test file (if any) corresponding to the Go file in the current active editor
 */
export function openTestFile(): void {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('Cannot open test file. No editor selected.');
		return;
	}
	let filePath = editor.document.fileName;
	if (!filePath.endsWith('.go')) {
		vscode.window.showInformationMessage('Cannot open test file. File in the editor is not a Go file.');
		return;
	}
	let testFilePath = filePath.substr(0, filePath.lastIndexOf('.go')) + '_test.go';

	vscode.commands.executeCommand('vscode.open', vscode.Uri.file(testFilePath));
}

/**
 * Opens the Go file with implementation for the test file in the current active editor
 */
export function openImplementationForTestFile(): void {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('Cannot open file. No editor selected.');
		return;
	}
	let filePath = editor.document.fileName;
	if (!filePath.endsWith('_test.go')) {
		vscode.window.showInformationMessage('Cannot open file. File in the editor is not a Go test file.');
		return;
	}
	let testFilePath = filePath.substr(0, filePath.lastIndexOf('_test.go')) + '.go';

	vscode.commands.executeCommand('vscode.open', vscode.Uri.file(testFilePath));
}

export function generateTestCurrentPackage(): Thenable<boolean> {
	let editor = checkActiveEditor();
	if (!editor) {
		return;
	}
	let dir = path.dirname(editor.document.uri.fsPath);
	let message = 'Unit tests generated for package: ' + path.basename(dir);
	return generateTests({ dir: dir });
}

export function generateTestCurrentFile(): Thenable<boolean> {
	let editor = checkActiveEditor();
	if (!editor) {
		return;
	}
	let file = editor.document.uri.fsPath;
	let message = 'Unit tests generated for file: ' + path.basename(file);
	return generateTests({ dir: file });
}

export function generateTestCurrentFunction(): Thenable<boolean> {
	let editor = checkActiveEditor();
	if (!editor) {
		return;
	}
	let file = editor.document.uri.fsPath;
	getFunctions(editor.document).then(functions => {
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
		let message = 'Unit test generated for function: ' + currentFunction.name + ' in file: ' + path.basename(file);
		return generateTests({ dir: file, func: currentFunction.name });
	}).then(null, err => {
		console.error(err);
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
					openTestFile();
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
