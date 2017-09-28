'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import fs = require('fs');
import { getGoRuntimePath } from './goPath';
import { getCurrentGoPath, getImportPath } from './util';

export function goGetPackage() {
	const editor = vscode.window.activeTextEditor;
	const selection = editor.selection;
	const selectedText = editor.document.lineAt(selection.active.line).text;

	const importPath = getImportPath(selectedText);
	if (importPath === '') {
		vscode.window.showErrorMessage('No import path to get');
		return;
	}

	const goRuntimePath = getGoRuntimePath();
	if (!goRuntimePath) {
		return vscode.window.showErrorMessage('Could not locate Go binaries. Make sure you have Go installed');
	}

	cp.execFile(goRuntimePath, ['get', importPath], (err, stdout, stderr) => {
		if (stderr !== '') {
			vscode.window.showErrorMessage(stderr);
			return;
		}

		vscode.window.showInformationMessage(`Successfully fetched package ${importPath}`);
	});
};
