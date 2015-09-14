/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import monaco = require('monaco');
import cp = require('child_process');

class DeclartionSupport implements monaco.Modes.IDeclarationSupport {

	private modelService: monaco.Services.IModelService;

	constructor(modelService: monaco.Services.IModelService) {
		this.modelService = modelService;
	}

	public findDeclaration(resource:monaco.URI, position:monaco.IPosition, token: monaco.CancellationToken):Promise<monaco.Modes.IReference> {

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
					var definitionResource = monaco.URI.file(file);
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