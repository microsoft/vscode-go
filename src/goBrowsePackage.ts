/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getGoRuntimePath } from './goPath';
import path = require('path');
import { goListAll } from './goPackages';

export function browsePackages() {
	const goRuntimePath = getGoRuntimePath();
	if (!goRuntimePath) {
		return;
	}
	let selection = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.selection : undefined;
	let selectedText = (selection && !selection.isEmpty) ? vscode.window.activeTextEditor.document.getText(selection) : '';

	goListAll().then(pkgMap => {
		const pkgs: string[] = Array.from(pkgMap.keys());
		if (!pkgs || pkgs.length === 0) {
			return;
		}
		let selectPkgPromise: Thenable<string> = Promise.resolve(selectedText);
		if (!selectedText || pkgs.indexOf(selectedText) === -1) {
			selectPkgPromise = vscode.window.showQuickPick(pkgs);
		}
		selectPkgPromise.then(pkg => {
			cp.execFile(goRuntimePath, ['list', '-f', '{{.Dir}}:{{.GoFiles}}:{{.TestGoFiles}}:{{.XTestGoFiles}}', pkg], (err, stdout, stderr) => {
				if (!stdout || stdout.indexOf(':') === -1) {
					return;
				}
				let matches = stdout.match(/(.*):\[(.*)\]:\[(.*)\]:\[(.*)\]/);
				if (matches) {
					let dir = matches[1];
					let files = matches[2] ? matches[2].split(' ') : [];
					let testfiles = matches[3] ? matches[3].split(' ') : [];
					let xtestfiles = matches[4] ? matches[4].split(' ') : [];
					files = files.concat(testfiles);
					files = files.concat(xtestfiles);
					vscode.window.showQuickPick(files).then(file => {
						vscode.workspace.openTextDocument(path.join(dir, file)).then(document => {
							vscode.window.showTextDocument(document);
						});
					});
				}
			});
		});
	});

}
