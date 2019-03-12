/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath, getToolsEnvVars } from './util';
import { promptForMissingTool } from './goInstallTools';
import { dirname, isAbsolute } from 'path';

/**
 * Extracts function out of current selection and replaces the current selection with a call to the extracted function.
 */
export function extractFunction() {
	extract('extract');
}

/**
 * Extracts expression out of current selection into a var in the local scope and
 * replaces the current selection with the new var.
 */
export function extractVariable() {
	extract('var');
}

type typeOfExtraction = 'var' | 'extract';

async function extract(type: typeOfExtraction): Promise<void> {
	let activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (activeEditor.selections.length !== 1) {
		vscode.window.showInformationMessage(
			`You need to have a single selection for extracting ${type === 'var' ? 'variable' : 'method'}`
		);
		return;
	}

	const newName = await vscode.window.showInputBox({
		placeHolder: 'Please enter a name for the extracted variable.'
	});

	if (!newName) {
		return;
	}

	runGoDoctor(
		newName,
		activeEditor.selection,
		activeEditor.document.fileName,
		type
	);
}

/**
 * @param newName name for the extracted method
 * @param selection the editor selection from which method is to be extracted
 * @param activeEditor the editor that will be used to apply the changes from godoctor
 * @returns errorMessage in case the method fails, null otherwise
 */
function runGoDoctor(
	newName: string,
	selection: vscode.Selection,
	fileName: string,
	type: typeOfExtraction
): Thenable<void> {
	const godoctor = getBinPath('godoctor');

	return new Promise((resolve, reject) => {
		if (!isAbsolute(godoctor)) {
			promptForMissingTool('godoctor');
			return resolve();
		}

		cp.execFile(
			godoctor,
			[
				'-w',
				'-pos',
				`${selection.start.line + 1},${selection.start.character +
				1}:${selection.end.line + 1},${selection.end.character}`,
				'-file',
				fileName,
				type,
				newName
			],
			{
				env: getToolsEnvVars(),
				cwd: dirname(fileName)
			},
			(err, stdout, stderr) => {
				if (err) {
					vscode.window.showErrorMessage(stderr || err.message);
				}
			}
		);
	});
}
