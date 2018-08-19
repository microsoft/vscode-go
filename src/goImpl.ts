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
import { browsePackages } from './goBrowsePackage';

export function implCursor() {
	let editor = vscode.window.activeTextEditor;
	let cursor = editor.selection;
	let typeName = '';
	let inputValue = '';
	if (!cursor.isEmpty) {
		typeName = editor.document.getText(cursor).trim();
		if  (typeName.length > 0) {
			inputValue = typeName[0] + ' *' + typeName;
		}
	}
	return vscode.window.showInputBox({
		ignoreFocusOut: true,
		value: inputValue,
		placeHolder: 'f *File io.Closer',
		prompt: 'Enter receiver type name and interface(blank for manual search) to implement.You may choose the position of insretion before "Enter"'
	}).then(implInput => {
		if (typeof implInput === 'undefined') {
			return;
		}
		let inputArgs = implInput.split(' ');
		if (!inputArgs) {
			vscode.window.showInformationMessage(`Not parsable input: ${implInput}`);
			return;
		}
		let typeArg = '';
		let interfaceArg = '';
		if (inputArgs.length === 1) {
			// assume the only arg here be the type name,
			// use it's first character as reciever variable
			// and let user search the interface arg
			typeArg = inputArgs[0][0].toLowerCase() + ' ' + ((inputArgs[0].startsWith('*')) ? inputArgs[0] : ('*' + inputArgs[0]));
		} else if (inputArgs.length === 2 ) {
			if (inputArgs[0].startsWith('*')) {
				// if the first arg starts with "*",
				// assume it as type name and the second one as interface name
				typeArg = inputArgs[0][0].toLowerCase() + ' *' + inputArgs[0] ;

			} else if (inputArgs[1].startsWith('*')) {
				// if the second arg starts with "*"
				// assume it as type name and the first one as reciever name,
				// let user search manually for interface name
				typeArg = inputArgs[0] + ' *' + inputArgs[1];
			} else {
				vscode.window.showInformationMessage('Cannot stub interface: wrong input arguments');
				return;
			}

		} else if (inputArgs.length === 3) {
			// all three args for impl is provided
			typeArg = '\'' + inputArgs[0] + ' ' + inputArgs[1] + '\'';
			interfaceArg = inputArgs[2];
		} else {
			vscode.window.showInformationMessage('Cannot stub interface: too many input arguments');
			return;
		}
		if (interfaceArg.length === 0) {
			// let user search manually for interface name
			interfaceArg = getSelectedInterface();
			if (interfaceArg.length === 0) {
				vscode.window.showInformationMessage('Cannot stub interface: no interface selected');
				return;
			}
		} else {
			interfaceArg = getFullPathForInterface(interfaceArg);
		}

		typeArg = '\'' + typeArg + '\'';
		runGoImpl([typeArg, interfaceArg], cursor.start);
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

function getSelectedInterface(): string {
	browsePackages();
	return '';
}

function getFullPathForInterface(inputPath: string): string {
	return '';
}