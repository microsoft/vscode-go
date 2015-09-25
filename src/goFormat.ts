/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

class FormattingSupport implements vscode.Modes.IFormattingSupport {

	private formatCommand = "goreturns";

	public autoFormatTriggerCharacters: string[] = [';', '}', '\n'];

	constructor() {
		vscode.plugins.getConfigurationObject('go').getValue<string>('formatTool').then(formatTool => {
			if(formatTool) {
				this.formatCommand = formatTool;
			}
		});
	}

	// TODO: work around bug that Code always calls formatRange
	public formatRange(document: vscode.Document, range: vscode.Range, options: vscode.Modes.IFormattingOptions, token: vscode.CancellationToken): Thenable<vscode.Modes.ISingleEditOperation[]> {
		return this.formatDocument(document, options, token)
	}

	public formatDocument(document: vscode.Document, options: vscode.Modes.IFormattingOptions, token: vscode.CancellationToken): Thenable<vscode.Modes.ISingleEditOperation[]> {
		// TODO: We don't really need to save all the buffers, just the one for 'resource.
		return vscode.workspace.anyDirty().then(anyDirty => {
			if (anyDirty) {
				vscode.workspace.saveAll(false).then(() => {
					return this.doFormatDocument(document, options, token);
				});
			}
			return this.doFormatDocument(document, options, token);
		});
	}

	private doFormatDocument(document: vscode.Document, options: vscode.Modes.IFormattingOptions, token: vscode.CancellationToken):Thenable<vscode.Modes.ISingleEditOperation[]> {
		return new Promise((resolve, reject) => {
			var filename = document.getUri().fsPath;

			var goreturns = path.join(process.env["GOPATH"], "bin", this.formatCommand);

			cp.execFile(goreturns, [filename], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'goreturns' command is not available.  Use 'go get -u sourcegraph.com/sqs/goreturns' to install.");
						return resolve(null);
					}
					if (err) return reject("Cannot format due to syntax errors.");
					var result = stdout.toString();
					// TODO: Should use `-d` option to get a diff and then compute the
					// specific edits instead of replace whole buffer
					var lastLine = document.getLineCount();
					var lastLineLastCol = document.getLineMaxColumn(lastLine);
					// API TODO: ISingleEditOperation is using IRange instead of Range
					//var range = new vscode.Range(1, 1, lastLine, lastLineLastCol);
					var range = {
							startLineNumber: 1,
							startColumn: 1,
							endLineNumber: lastLine,
							endColumn: lastLineLastCol
					};
					return resolve([{
						text: result,
						range
					}]);
				} catch(e) {
					reject(e);
				}
			});
		});
	}

}

export = FormattingSupport