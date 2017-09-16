'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import fs = require('fs');
import { getGoRuntimePath } from './goPath';
import { getCurrentGoPath } from './util';

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
			if (stderr != '') {
				vscode.window.showErrorMessage(stderr);
				return;
			}
	
			vscode.window.showInformationMessage(`Successfully fetched package ${importPath}`);
		});
	});
};

// TODO: maybe move this to some util package? It's copied from goBrowsePackages.ts
function getImportPath(text: string): string {
	// Catch cases like `import alias "importpath"` and `import "importpath"`
	let singleLineImportMatches = text.match(/^\s*import\s+([a-z,A-Z,_,\.]\w*\s+)?\"([^\"]+)\"/);
	if (singleLineImportMatches) {
		return singleLineImportMatches[2];
	}

	// Catch cases like `alias "importpath"` and "importpath"
	let groupImportMatches = text.match(/^\s*([a-z,A-Z,_,\.]\w*\s+)?\"([^\"]+)\"/);
	if (groupImportMatches) {
		return groupImportMatches[2];
	}

	return text.trim();
}
