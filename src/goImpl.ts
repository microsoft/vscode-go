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

const inputRegex = /^(\w+\ \*?\w+\ )?([\w./]+)$/;

export function implCursor() {
	let editor = vscode.window.activeTextEditor;
	let cursor = editor.selection;
	let typeName = '';
	let typeArg = '';
	let placeHolder = 'f *File io.Closer';
	if (!cursor.isEmpty) {
		typeName = editor.document.getText(cursor).trim();
		if  (typeName.length > 0) {
			typeArg = '\'' + typeName[0] + ' *' + typeName + '\'';
			placeHolder = typeArg + 'interface("$" for search manually)';
		}
	}
	return vscode.window.showInputBox({
		placeHolder: placeHolder,
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
		if (typeArg.length === 0) {
			typeArg = '\'' + matches[1] + '\'';
		}
		runGoImpl([typeArg, matches[2]], cursor.start);
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