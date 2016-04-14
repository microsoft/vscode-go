/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath } from './goPath';
import { byteOffsetAt, canonicalizeGOPATHPrefix } from './util';

export class GoRenameProvider implements vscode.RenameProvider {

	public provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Thenable<vscode.WorkspaceEdit> {
		return vscode.workspace.saveAll(false).then(() => {
			return this.doRename(document, position, newName, token);
		});
	}

	private doRename(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Thenable<vscode.WorkspaceEdit> {
		return new Promise((resolve, reject) => {
			let filename = canonicalizeGOPATHPrefix(document.fileName);
			let range = document.getWordRangeAtPosition(position);
			let pos = range ? range.start : position;
			let offset = byteOffsetAt(document, pos);

			let gorename = getBinPath('gorename');

			cp.execFile(gorename, ['-offset', filename + ':#' + offset, '-to', newName], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						vscode.window.showInformationMessage('The "gorename" command is not available.  Use "go get golang.org/x/tools/cmd/gorename" to install.');
						return Promise.resolve<vscode.WorkspaceEdit>(null);
					}
					if (err) return reject('Cannot rename due to errors: ' + stderr);
					// TODO: 'gorename' makes the edits in the files out of proc.
					// Would be better if we could get the list of edits.
					return Promise.resolve<vscode.WorkspaceEdit>(null);
				} catch (e) {
					reject(e);
				}
			});
		});
	}
	
}
