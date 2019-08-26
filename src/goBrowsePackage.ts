/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getAllPackages } from './goPackages';
import { getImportPath, getCurrentGoPath, getBinPath } from './util';
import { envPath } from './goPath';

export function browsePackages() {
	let workDir = '';
	let currentUri: vscode.Uri = null;
	let selectedText = '';
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		currentUri = vscode.window.activeTextEditor.document.uri;
		workDir = path.dirname(currentUri.fsPath);
		const selection = editor.selection;
		if (!selection.isEmpty) {
			// get selected text
			selectedText = editor.document.getText(selection);
		} else {
			// if selection is empty, then get the whole line the cursor is currently on.
			selectedText = editor.document.lineAt(selection.active.line).text;
		}
		selectedText = getImportPath(selectedText) || selectedText.trim();
	} else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length === 1) {
		currentUri = vscode.workspace.workspaceFolders[0].uri;
		workDir = currentUri.fsPath;
	}

	showPackageFiles(selectedText, true, workDir);

}

function showPackageFiles(pkg: string, showAllPkgsIfPkgNotFound: boolean, workDir: string) {
	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		return vscode.window.showErrorMessage(`Failed to run "go list" to fetch packages as the "go" binary cannot be found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`);
	}

	if (!pkg && showAllPkgsIfPkgNotFound) {
		return showPackageList(workDir);
	}

	const options: { [key: string]: any } = {
		env: Object.assign({}, process.env, { GOPATH: getCurrentGoPath() })
	};

	if (workDir) {
		options['cwd'] = workDir;
	}

	cp.execFile(goRuntimePath, ['list', '-f', '{{.Dir}}:{{.GoFiles}}:{{.TestGoFiles}}:{{.XTestGoFiles}}', pkg], options, (err, stdout, stderr) => {
		if (!stdout || stdout.indexOf(':') === -1) {
			if (showAllPkgsIfPkgNotFound) {
				return showPackageList(workDir);
			}

			return;
		}

		const matches = stdout && stdout.match(/(.*):\[(.*)\]:\[(.*)\]:\[(.*)\]/);
		if (matches) {
			const dir = matches[1];
			let files = matches[2] ? matches[2].split(' ') : [];
			const testfiles = matches[3] ? matches[3].split(' ') : [];
			const xtestfiles = matches[4] ? matches[4].split(' ') : [];
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

function showPackageList(workDir: string) {
	return getAllPackages(workDir).then(pkgMap => {
		const pkgs: string[] = Array.from(pkgMap.keys());
		if (pkgs.length === 0) {
			return vscode.window.showErrorMessage('Could not find packages. Ensure `gopkgs -format {{.Name}};{{.ImportPath}}` runs successfully.');
		}

		vscode
			.window
			.showQuickPick(pkgs.sort(), { placeHolder: 'Select a package to browse' })
			.then(pkgFromDropdown => {
				if (!pkgFromDropdown) return;
				showPackageFiles(pkgFromDropdown, false, workDir);
			});
	});

}
