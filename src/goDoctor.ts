/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath, getToolsEnvVars } from './util';
import { promptForMissingTool } from './goInstallTools';
import { dirname } from 'path';
import { resolve } from 'dns';

/**
 * Extracts function out of current selection and replaces the current selection with a call to the extracted function.
 */
export function extractFunction() {
	let activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (activeEditor.selections.length !== 1) {
		vscode.window.showInformationMessage('You need to have a single selection for extracting method');
		return;
	}
	let showInputBoxPromise = vscode.window.showInputBox({ placeHolder: 'Plese enter a name for the extracted function.' });
	showInputBoxPromise.then((functionName: string) => {
		runGoDoctorExtract(functionName, activeEditor.selection, activeEditor).then(errorMessage => {
			if (errorMessage) {
				vscode.window.showErrorMessage(errorMessage);
			}
		});
	});
}

/**
 * Extracts expression out of current selection into a var in the local scope and
 * replaces the current selection with the new var.
 */
export function extractVariable() {
	let activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (activeEditor.selections.length !== 1) {
		vscode.window.showInformationMessage('You need to have a single selection for extracting variable');
		return;
	}
	let showInputBoxPromise = vscode.window.showInputBox({ placeHolder: 'Plese enter a name for the extracted variable.' });
	showInputBoxPromise.then((varName: string) => {
		runGoDoctorVar(varName, activeEditor.selection, activeEditor).then(errorMessage => {
			if (errorMessage) {
				vscode.window.showErrorMessage(errorMessage);
			}
		});
	});
}

/**
* @param functionName name for the extracted method
* @param selection the editor selection from which method is to be extracted
* @param activeEditor the editor that will be used to apply the changes from godoctor
* @returns errorMessage in case the method fails, null otherwise
*/
export function runGoDoctorExtract(functionName: string, selection: vscode.Selection, activeEditor: vscode.TextEditor): Thenable<string> {
	let godoctor = getBinPath('godoctor');

	return new Promise((resolve, reject) => {
		if (typeof functionName === 'undefined') {
			return resolve('Function Name is undefined');
		}
		let args = [
			'-w',
			'-pos',
			`${selection.start.line + 1},${selection.start.character + 1}:${selection.end.line + 1},${selection.end.character + 1}`,
			'-file',
			activeEditor.document.fileName,
			'extract',
			functionName,
		];
		let p = cp.execFile(godoctor, args, { env: getToolsEnvVars(), cwd: dirname(activeEditor.document.fileName) }, (err, stdout, stderr) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool('godoctor');
				return resolve('Could not find godoctor');
			}
			if (err) {
				return resolve(`Could not extract function : \n\n${stderr}`);
			}
		});
		if (p.pid) {
			p.stdin.end();
		}

	});
}

/**
* @param varName name for the extracted method
* @param selection the editor selection from which method is to be extracted
* @param activeEditor the editor that will be used to apply the changes from godoctor
* @returns errorMessage in case the method fails, null otherwise
*/
export function runGoDoctorVar(varName: string, selection: vscode.Selection, activeEditor: vscode.TextEditor): Thenable<string> {
	let godoctor = getBinPath('godoctor');

	return new Promise((resolve, reject) => {
		if (typeof varName === 'undefined') {
			return resolve('Function Name is undefined');
		}
		let args = [
			'-w',
			'-pos',
			`${selection.start.line + 1},${selection.start.character + 1}:${selection.end.line + 1},${selection.end.character + 1}`,
			'-file',
			activeEditor.document.fileName,
			'var',
			varName,
		];
		let p = cp.execFile(godoctor, args, { env: getToolsEnvVars(), cwd: dirname(activeEditor.document.fileName) }, (err, stdout, stderr) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool('godoctor');
				return resolve('Could not find godoctor');
			}
			if (err) {
				return resolve(`Could not extract variable : \n\n${stderr}`);
			}
		});
		if (p.pid) {
			p.stdin.end();
		}

	});
}