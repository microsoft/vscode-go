/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

class DeclartionSupport implements vscode.Modes.IDeclarationSupport {

	private modelService: vscode.Services.IModelService;

	constructor(modelService: vscode.Services.IModelService) {
		this.modelService = modelService;
	}

	public findDeclaration(resource:vscode.Uri, position:vscode.IPosition, token: vscode.CancellationToken):Promise<vscode.Modes.IReference> {

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
					// TODO: Goto def on a package name import will return juts a plain
					// path to a folder here - can we go to a folder?
					var match = /(.*):(\d+):(\d+)/.exec(lines[0]);
					if(!match) return resolve(null);
					var [_, file, line, col] = match;
					var definitionResource = vscode.Uri.file(file);
					return resolve({
						resource: definitionResource,
						range: {
							startLineNumber: +line,
							startColumn: +col,
							endLineNumber: +line,
							endColumn: +col + 1
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

export = DeclartionSupport;