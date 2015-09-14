/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');

class DeclartionSupport implements vscode.Modes.IDeclarationSupport {

	private modelService: vscode.Services.IModelService;

	constructor(modelService: vscode.Services.IModelService) {
		this.modelService = modelService;
	}

	public findDeclaration(resource:vscode.URI, position:vscode.IPosition, token: vscode.CancellationToken):Promise<vscode.Modes.IReference> {

		return new Promise((resolve, reject) => {
			var path = resource.fsPath;
			var model = this.modelService.getModel(resource);
			var wordAtPosition = model.getWordAtPosition(position);

			// compute the file offset for position
			var offset = position.column;
			for (var row = 1; row < position.lineNumber; row++) {
				offset += model.getLineMaxColumn(row);
			}

			// Spawn `godef` process
			var process = cp.execFile("godef", ["-t", "-i", "-f", path, "-o", offset.toString()], {}, (err, stdout, stderr) => {
				try {
					if (err) return resolve(null);
					var result = stdout.toString();
					var lines = result.split('\n');
					var [_, file, line, col] = /(.*):(\d+):(\d+)/.exec(lines[0]);
					var definitionResource = vscode.URI.file(file);
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
			process.stdin.end(model.getValue());
		});
	}
}

export = DeclartionSupport;