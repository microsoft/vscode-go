/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getGoRuntimePath } from './goPath';
import path = require('path');
import { goListAll, isGoListComplete } from './goPackages';

export function browsePackages() {
	let selectedText = '';
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		let selection = editor.selection;
		if (!selection.isEmpty) {
			// get selected text
			selectedText = editor.document.getText(selection);
		} else {
			// if selection is empty, then get the whole line the cursor is currently on.
			selectedText = editor.document.lineAt(selection.active.line).text;
		}
		selectedText = getImportPath(selectedText);
	}

	showPackageFiles(selectedText);
}

function showPackageFiles(pkg: string)  {
	const goRuntimePath = getGoRuntimePath();
	if (!goRuntimePath) {
		return vscode.window.showErrorMessage('Could not locate Go path. Make sure you have Go installed');
	}

	cp.execFile(goRuntimePath, ['list', '-f', '{{.Dir}}:{{.GoFiles}}:{{.TestGoFiles}}:{{.XTestGoFiles}}', pkg], (err, stdout, stderr) => {
		if (!stdout || stdout.indexOf(':') === -1) {
			if (isGoListComplete()) {
				return showPackageList();
			}

			return showTryAgainLater();
		}

		let matches = stdout && stdout.match(/(.*):\[(.*)\]:\[(.*)\]:\[(.*)\]/);
		if (matches) {
			let dir = matches[1];
			let files = matches[2] ? matches[2].split(' ') : [];
			let testfiles = matches[3] ? matches[3].split(' ') : [];
			let xtestfiles = matches[4] ? matches[4].split(' ') : [];
			files = files.concat(testfiles);
			files = files.concat(xtestfiles);
			vscode.window.showQuickPick(files, { placeHolder: `Below are Go files from ${pkg}` }).then(file => {
				// if user abandoned list, file will be null and path.join will error out.
				// therefore return.
				if (!file) return;

				vscode.workspace.openTextDocument(path.join(dir, file)).then(document => {
					vscode.window.showTextDocument(document);
				});
			});
		}
	});
}

function showPackageList() {
	goListAll().then(pkgMap => {
		const pkgs: string[] = Array.from(pkgMap.keys());
		if (!pkgs || pkgs.length === 0) {
			return vscode.window.showErrorMessage('Could not find packages. Ensure `go list all` runs successfully.');
		}

		vscode
			.window
			.showQuickPick(pkgs, { placeHolder: 'Select a package to browse' })
			.then(pkgFromDropdown => {
				if (!pkgFromDropdown) return;
				showPackageFiles(pkgFromDropdown);
			});
	});
}

function showTryAgainLater() {
	// `go list all` has not completed. Wait for a second which is an acceptable duration of delay.
	setTimeout(() => {
		// `go list all` still not complete. It takes a long time on slower machines or when there are way too many folders in GOPATH
		if (!isGoListComplete()) {
			vscode.window.showInformationMessage('Finding packages... Try after sometime.');
			return;
		}
	}, 1000);
}

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
