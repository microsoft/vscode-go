/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

class RenameSupport implements vscode.Modes.IRenameSupport {

	private modelService: vscode.Services.IModelService;

	constructor(modelService: vscode.Services.IModelService) {
		this.modelService = modelService;
	}

	public rename(resource:vscode.Uri, position:vscode.IPosition, newName: string, token: vscode.CancellationToken): Thenable<vscode.Modes.IRenameResult> {
		return vscode.workspace.anyDirty().then(anyDirty => {
			if (anyDirty) {
				vscode.workspace.saveAll(false).then(() => {
					return this.doRename(resource, position, newName, token);
				});
			}
			return this.doRename(resource, position, newName, token);
		});
	}

	private doRename(resource:vscode.Uri, position:vscode.IPosition, newName: string, token: vscode.CancellationToken): Thenable<vscode.Modes.IRenameResult> {
		return new Promise((resolve, reject) => {
			var filename = this.canonicalizeForWindows(resource.fsPath);
			var model = this.modelService.getModel(resource);

			// compute the file offset for position
			var offset = model.getValueInRange({
				startLineNumber: 0,
				startColumn: 0,
				endLineNumber: position.lineNumber,
				endColumn: position.column
			}).length;

			var gorename = path.join(process.env["GOPATH"], "bin", "gorename");

			cp.execFile(gorename, ["-offset", filename+":#"+offset, "-to", newName], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.shell.showInformationMessage("The 'gorename' command is not available.  Use 'go get golang.org/x/tools/cmd/gorename' to install.");
						return resolve(null);
					}
					if (err) return reject("Cannot rename due to errors: " + err);
					// TODO: 'gorename' makes the edits in the files out of proc.
					//       Would be better if we coudl get the list of edits.
					return resolve({
						currentName: newName,
						edits: []
					});
				} catch(e) {
					reject(e);
				}
			});
		});
	}

	canonicalizeForWindows(filename:string):string {
		// capitalize drive letter on Windows otherwise gorename cannot find the package
		if (/^[a-z]:\\/.test(filename))
			return filename.charAt(0).toUpperCase() + filename.slice(1);
		return filename;
	}
}

export = RenameSupport