/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath';
import { byteOffsetAt } from './util';

export class GoRenameProvider implements vscode.RenameProvider {

	public provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Thenable<vscode.WorkspaceEdit> {
		return vscode.workspace.saveAll(false).then(() => {
			return this.doRename(document, position, newName, token);
		});
	}

	private doRename(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Thenable<vscode.WorkspaceEdit> {
		return new Promise((resolve, reject) => {
			let filename = this.canonicalizeForWindows(document.fileName);
			let offset = byteOffsetAt(document, position);

			let gorename = getBinPath('gorename');

			cp.execFile(gorename, ['-offset', filename + ':#' + offset, '-to', newName], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						vscode.window.showInformationMessage('The "gorename" command is not available.  Use "go get golang.org/x/tools/cmd/gorename" to install.');
						return Promise.resolve<vscode.WorkspaceEdit>(null);
					}
					if (err) return reject('Cannot rename due to errors: ' + err);
					// TODO: 'gorename' makes the edits in the files out of proc.
					// Would be better if we could get the list of edits.
					return Promise.resolve<vscode.WorkspaceEdit>(null);
				} catch (e) {
					reject(e);
				}
			});
		});
	}

	canonicalizeForWindows(filename: string): string {
		// capitalization of the GOPATH root must match GOPATH exactly
		let gopath: string = process.env['GOPATH'];
		if (!gopath) return filename;
		let workspaces = gopath.split(path.delimiter);
		for (let i = 0; i < workspaces.length; i++) {
			let workspace = workspaces[i];
			if (filename.toLowerCase().substring(0, workspace.length) === workspace.toLowerCase()) {
				return workspace + filename.slice(workspace.length);
			}
		}
		return filename;
	}
}
