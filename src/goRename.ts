/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');

class RenameSupport implements vscode.Modes.IRenameSupport {

	private modelService: vscode.Services.IModelService;

	constructor(modelService: vscode.Services.IModelService) {
		this.modelService = modelService;
	}

	public rename(resource:vscode.URI, position:vscode.IPosition, newName: string, token: vscode.CancellationToken): Promise<vscode.Modes.IRenameResult> {
		return new Promise((resolve, reject) => {
			var path = resource.fsPath;
			var model = this.modelService.getModel(resource);

			// compute the file offset for position
			var offset = position.column - 1;
			for (var row = 1; row < position.lineNumber; row++) {
				offset += model.getLineMaxColumn(row);
			}

			// TODO: Should really check if any ".go" files are dirty and block rename
			var process = cp.execFile("gorename", ["-offset", path+":#"+offset, "-to", newName], {}, (err, stdout, stderr) => {
				try {
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

}

export = RenameSupport