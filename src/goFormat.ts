/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import dmp = require('diff-match-patch');
import { getBinPath } from './goPath'

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
			var filename = document.fileName;

			var formatCommandBinPath = getBinPath(this.formatCommand);

			cp.execFile(formatCommandBinPath, [filename], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The '" + formatCommandBinPath + "' command is not available.  Please check your go.formatTool user setting and ensure it is installed.");
						return resolve(null);
					}
					if (err) return reject("Cannot format due to syntax errors.");
					var text = stdout.toString();
					var d = new dmp.diff_match_patch();

					var diffs = d.diff_main(document.getText(), text)
					var line = 0
					var character = 0
					var edits = new Array<vscode.TextEdit>()
					for (var i = 0; i < diffs.length; i++) {
						var start = new vscode.Position(line, character)

						// Compute the line/character after the diff is applied.
						for (var curr = 0; curr < diffs[i][1].length; curr++) {
							if (diffs[i][1][curr] != '\n') {
								character++
							} else {
								character = 0
								line++
							}
						}
						switch (diffs[i][0]) {
							case dmp.DIFF_DELETE:
								edits.push(vscode.TextEdit.delete(new vscode.Range(start, new vscode.Position(line, character))))
								break

							case dmp.DIFF_INSERT:
								// The edits are all relative to the original state of the document,
								// so inserts should reset the current line/character position to
								// the start.
								line = start.line
								character = start.character
								edits.push(vscode.TextEdit.insert(start, diffs[i][1]))
								break
								
							case dmp.DIFF_EQUAL:
								break
						}
					}

					return resolve(edits);
				} catch (e) {
					reject(e);
				}
			});
		});
	}

}
