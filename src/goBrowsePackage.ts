/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getGoRuntimePath } from './goPath';
import path = require('path');
import { getAllPackages } from './goPackages';
import { getImportPath, getCurrentGoPath } from './util';

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
		selectedText = getImportPath(selectedText) || selectedText.trim();
	}

	showPackageFiles(selectedText, true);
}

function showPackageFiles(pkg: string, showAllPkgsIfPkgNotFound: boolean) {
	const goRuntimePath = getGoRuntimePath();
	if (!goRuntimePath) {
		return vscode.window.showErrorMessage('Could not locate Go path. Make sure you have Go installed');
	}

	if (!pkg && showAllPkgsIfPkgNotFound) {
		return showPackageList();
	}

	const env = Object.assign({}, process.env, { GOPATH: getCurrentGoPath() });

	cp.execFile(goRuntimePath, ['list', '-f', '{{.Dir}}:{{.GoFiles}}:{{.TestGoFiles}}:{{.XTestGoFiles}}', pkg], { env }, (err, stdout, stderr) => {
		if (!stdout || stdout.indexOf(':') === -1) {
			if (showAllPkgsIfPkgNotFound) {
				return showPackageList();
			}

			return;
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
	getAllPackages().then(pkgMap => {
		const pkgs: string[] = Array.from(pkgMap.keys());
		if (pkgs.length === 0) {
			return vscode.window.showErrorMessage('Could not find packages. Ensure `gopkgs -format {{.Name}};{{.ImportPath}}` runs successfully.');
		}

		vscode
			.window
			.showQuickPick(pkgs.sort(), { placeHolder: 'Select a package to browse' })
			.then(pkgFromDropdown => {
				if (!pkgFromDropdown) return;
				showPackageFiles(pkgFromDropdown, false);
			});
	});
}
