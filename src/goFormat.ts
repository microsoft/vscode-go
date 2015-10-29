/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

export class GoDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {

	private formatCommand = "goreturns";

	// Not used?
	public autoFormatTriggerCharacters: string[] = [';', '}', '\n'];

	constructor() {
		let formatTool = vscode.workspace.getConfiguration('go')['formatTool'];
		if (formatTool) {
			this.formatCommand = formatTool;
		}
	}

	public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
		return document.save().then(() => {
			return this.doFormatDocument(document, options, token);
		});
	}

	private doFormatDocument(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
		return new Promise((resolve, reject) => {
			var filename = document.uri.fsPath;

			var goreturns = path.join(process.env["GOPATH"], "bin", this.formatCommand);

			cp.execFile(goreturns, [filename], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'goreturns' command is not available.  Use 'go get -u sourcegraph.com/sqs/goreturns' to install.");
						return resolve(null);
					}
					if (err) return reject("Cannot format due to syntax errors.");
					var text = stdout.toString();
					// TODO: Should use `-d` option to get a diff and then compute the
					// specific edits instead of replace whole buffer
					var lastLine = document.lineCount;
					var lastLineLastCol = document.lineAt(lastLine - 1).range.end.character;
					var range = new vscode.Range(0, 0, lastLine - 1, lastLineLastCol);
					return resolve([new vscode.TextEdit(range, text)]);
				} catch (e) {
					reject(e);
				}
			});
		});
	}

}