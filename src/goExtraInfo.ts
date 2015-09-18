/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

class ExtraInfoSupport implements vscode.Modes.IExtraInfoSupport {

	private modelService: vscode.Services.IModelService;

	constructor(modelService: vscode.Services.IModelService) {
		this.modelService = modelService;
	}

	public computeInfo(resource:vscode.Uri, position:vscode.IPosition, token: vscode.CancellationToken): Promise<vscode.Modes.IComputeExtraInfoResult> {

		return new Promise((resolve, reject) => {
			var filename = resource.fsPath;
			var model = this.modelService.getModel(resource);
			var wordAtPosition = model.getWordAtPosition(position);

			// compute the file offset for position
			var offset = model.getValueInRange({
				startLineNumber: 0,
				startColumn: 0,
				endLineNumber: position.lineNumber,
				endColumn: position.column
			}).length;

			var godef = path.join(process.env["GOPATH"], "bin", "godef");

			// Spawn `godef` process
			var p = cp.execFile(godef, ["-t", "-i", "-f", filename, "-o", offset.toString()], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.shell.showInformationMessage("The 'godef' command is not available.  Use 'go get -u github.com/rogpeppe/godef' to install.");
					}
					if (err) return resolve(null);
					var result = stdout.toString();
					var lines = result.split('\n');
					if(lines.length > 10) lines[9] = "...";
					var text = lines.slice(1,10).join('\n');
					return resolve({
						htmlContent: [
							{ formattedText: text }
						],
						range: {
							startLineNumber: position.lineNumber,
							startColumn: wordAtPosition ? wordAtPosition.startColumn : position.column,
							endLineNumber: position.lineNumber,
							endColumn: wordAtPosition ? wordAtPosition.endColumn : position.column
						}
					});
				} catch(e) {
					reject(e);
				}
			});
			p.stdin.end(model.getValue());
		});
	}
}

export = ExtraInfoSupport;