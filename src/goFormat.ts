/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import monaco = require('monaco');
import cp = require('child_process');

class FormattingSupport implements monaco.Modes.IFormattingSupport {

	private modelService: monaco.Services.IModelService;

	public autoFormatTriggerCharacters: string[] = [';', '}', '\n'];

	constructor(modelService: monaco.Services.IModelService) {
		this.modelService = modelService;
	}

	public formatDocument(resource: monaco.URI, options: monaco.Modes.IFormattingOptions, token: monaco.CancellationToken):Promise<monaco.Models.ISingleEditOperation[]> {
		return new Promise((resolve, reject) => {
			var path = resource.fsPath;
			var model = this.modelService.getModel(resource);
			// TODO: Should really check if the model is dirty and block formatting
			var process = cp.execFile("goreturns", [path], {}, (err, stdout, stderr) => {
				try {
					if (err) return reject("Cannot format due to syntax errors.");
					var result = stdout.toString();
					// TODO: Should use `-d` option to get a diff and then compute the
					// specific edits instead of replace whole buffer
					var lastLine = model.getLineCount();
					var lastLineLastCol = model.getLineMaxColumn(lastLine);
					return resolve([{
						text: result,
						range: {
							startLineNumber: 1,
							startColumn: 1,
							endLineNumber: lastLine,
							endColumn: lastLineLastCol
						}
					}]);
				} catch(e) {
					reject(e);
				}
			});
		});
	}

}

export = FormattingSupport