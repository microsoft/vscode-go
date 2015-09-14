/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import monaco = require('monaco');
import cp = require('child_process');

class ExtraInfoSupport implements monaco.Modes.IExtraInfoSupport {

	private modelService: monaco.Services.IModelService;

	constructor(modelService: monaco.Services.IModelService) {
		this.modelService = modelService;
	}

	public computeInfo(resource:monaco.URI, position:monaco.IPosition, token: monaco.CancellationToken): Promise<monaco.Modes.IComputeExtraInfoResult> {

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
			process.stdin.end(model.getValue());
		});
	}
}

export = ExtraInfoSupport;