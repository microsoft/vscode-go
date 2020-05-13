/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import { dirname } from 'path';
import vscode = require('vscode');
import { promptForMissingTool } from './goInstallTools';
import { getBinPath, getToolsEnvVars } from './util';

// Supports only passing interface, see TODO in implCursor to finish
const inputRegex = /^(\w+\ \*?\w+\ )?([\w./]+)$/;

export function implCursor() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage('No active editor found.');
		return;
	}
	const cursor = editor.selection;
	return vscode.window
		.showInputBox({
			placeHolder: 'f *File io.Closer',
			prompt: 'Enter receiver and interface to implement.'
		})
		.then((implInput) => {
			if (typeof implInput === 'undefined') {
				return;
			}
			const matches = implInput.match(inputRegex);
			if (!matches) {
				vscode.window.showInformationMessage(`Not parsable input: ${implInput}`);
				return;
			}

			// TODO: automatically detect type name at cursor
			// if matches[1] is undefined then detect receiver type
			// take first character and use as receiver name

			runGoImpl([matches[1], matches[2]], cursor.start, editor);
		});
}

function runGoImpl(args: string[], insertPos: vscode.Position, editor: vscode.TextEditor) {
	const goimpl = getBinPath('impl');
	const p = cp.execFile(
		goimpl,
		args,
		{ env: getToolsEnvVars(), cwd: dirname(editor.document.fileName) },
		(err, stdout, stderr) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool('impl');
				return;
			}

			if (err) {
				vscode.window.showInformationMessage(`Cannot stub interface: ${stderr}`);
				return;
			}

			editor.edit((editBuilder) => {
				editBuilder.insert(insertPos, stdout);
			});
		}
	);
	if (p.pid) {
		p.stdin.end();
	}
}
