/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { getImportPath, getCurrentGoPath, getBinPath } from './util';
import { outputChannel } from './goStatus';
import { buildCode } from './goBuild';
import { goGet } from './goCommand';

export async function goGetPackage() {
	const editor = vscode.window.activeTextEditor;
	const selection = editor.selection;
	const selectedText = editor.document.lineAt(selection.active.line).text;

	const importPath = getImportPath(selectedText);
	if (importPath === '') {
		vscode.window.showErrorMessage('No import path to get');
		return;
	}

	const env = Object.assign({}, process.env, { GOPATH: getCurrentGoPath() });
	const result = await goGet(importPath, ['-v'], { env });

	// go get -v doesn't write anything when the package already exists
	if (result.stderr === '') {
		vscode.window.showInformationMessage(`Package already exists: ${importPath}`);
	}

	outputChannel.show();
	outputChannel.clear();
	outputChannel.appendLine(result.stderr);
	buildCode();
	return;
}
