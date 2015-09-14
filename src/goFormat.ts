/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');

class FormattingSupport implements vscode.Modes.IFormattingSupport {

	private modelService: vscode.Services.IModelService;

	public autoFormatTriggerCharacters: string[] = [';', '}', '\n'];

	constructor(modelService: vscode.Services.IModelService) {
		this.modelService = modelService;
	}

	public formatDocument(resource: vscode.URI, options: vscode.Modes.IFormattingOptions, token: vscode.CancellationToken):Promise<vscode.Models.ISingleEditOperation[]> {
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