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

export function generateTestCurrentPackage(): Thenable<boolean>  {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('gotests: No editor selected');
		return;
	}
	let dir = path.dirname(editor.document.uri.fsPath);
	let message = 'Unit tests generated for package: ' + path.basename(dir);
	return generateTests({dir: dir, msg: message });
}

export function generateTestCurrentFile(): Thenable<boolean>  {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('gotests: No editor selected');
		return;
	}
	let file = editor.document.uri.fsPath;
	let message = 'Unit tests generated for file: ' + path.basename(file);
	return generateTests({dir: file, msg: message });
}

export function generateTestCurrentFunction(): Thenable<boolean> {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('gotests: No selected Editor');
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
		return generateTests({dir: file, msg: message, func: currentFunction.name});
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
	 * The Message that show up in case of success
	 */
	msg: string;
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
					return reject('Cannot generate test due to errors: ' + stderr);
				}
				let message = 'gotests: ' + conf.msg;
				vscode.window.showInformationMessage(message);
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
