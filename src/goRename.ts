/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

export class GoRenameProvider implements vscode.RenameProvider {

	public provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Thenable<vscode.WorkspaceEdit> {
		return vscode.workspace.saveAll(false).then(() => {
			return this.doRename(document, position, newName, token);
		});
	}

	private doRename(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Thenable<vscode.WorkspaceEdit> {
		return new Promise((resolve, reject) => {
			var filename = this.canonicalizeForWindows(document.uri.fsPath);

			// compute the file offset for position
			var range = new vscode.Range(0, 0, position.line, position.character);
			var offset = document.getText(range).length;

			var gorename = path.join(process.env["GOPATH"], "bin", "gorename");

			cp.execFile(gorename, ["-offset", filename + ":#" + offset, "-to", newName], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'gorename' command is not available.  Use 'go get golang.org/x/tools/cmd/gorename' to install.");
						return resolve(null);
					}
					if (err) return reject("Cannot rename due to errors: " + err);
					// TODO: 'gorename' makes the edits in the files out of proc.
					// Would be better if we coudl get the list of edits.
					return Promise.resolve<vscode.WorkspaceEdit>(null);
				} catch (e) {
					reject(e);
				}
			});
		});
	}

	canonicalizeForWindows(filename: string): string {
		// capitalization of the GOPATH root must match GOPATH exactly
		var gopath: string = process.env['GOPATH']
		if (!gopath) return filename;
		if (filename.toLowerCase().substring(0, gopath.length) != gopath.toLowerCase()) return filename;
		return gopath + filename.slice(gopath.length);
	}
}
