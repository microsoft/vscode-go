'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import fs = require('fs');
import { getGoRuntimePath } from './goPath';
import { getCurrentGoPath, getImportPath } from './util';

export function goGetImport() {
	const editor = vscode.window.activeTextEditor;
	const selection = editor.selection;
	const selectedText = editor.document.lineAt(selection.active.line).text;

	const importPath = getImportPath(selectedText);

	const goRuntimePath = getGoRuntimePath();
	if (!goRuntimePath) {
		return vscode.window.showErrorMessage('Could not locate Go binaries. Make sure you have Go installed');
	}

	fs.exists(path.join(getCurrentGoPath(), 'src', importPath), (exists) => {
		if (exists) {
			vscode.window.showInformationMessage(`Package ${importPath} already exists`);
			return;
		}

		cp.execFile(goRuntimePath, ['get', '-u', importPath], (err, stdout, stderr) => {
			if (stderr !== '') {
				vscode.window.showErrorMessage(stderr);
				return;
			}

			vscode.window.showInformationMessage(`Successfully fetched package ${importPath}`);
		});
	});
};
