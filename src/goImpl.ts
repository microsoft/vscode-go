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

// Supports only passing interface, see TODO in implCursor to finish
const inputRegex = /^(\w+\ \*?\w+\ )?([\w./]+)$/;

export function implCursor() {
	let cursor = vscode.window.activeTextEditor.selection;
	return vscode.window.showInputBox({
		placeHolder: 'f *File io.Closer',
		prompt: 'Enter receiver and interface to implement.'
	}).then(implInput => {
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

		runGoImpl([matches[1], matches[2]], cursor.start);
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
