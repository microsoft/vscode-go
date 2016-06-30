/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import dmp = require('diff-match-patch');
import { getBinPath } from './goPath';
import { EditTypes, Edit } from './util';

export class Formatter {
	private formatCommand = 'goreturns';

	constructor() {
		let formatTool = vscode.workspace.getConfiguration('go')['formatTool'];
		if (formatTool) {
			this.formatCommand = formatTool;
		}
	}

	public formatDocument(document: vscode.TextDocument): Thenable<vscode.TextEdit[]> {
		return new Promise((resolve, reject) => {
			let filename = document.fileName;

			let formatCommandBinPath = getBinPath(this.formatCommand);

			cp.execFile(formatCommandBinPath, [filename], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						vscode.window.showInformationMessage('The "' + formatCommandBinPath + '" command is not available.  Please check your go.formatTool user setting and ensure it is installed.');
						return resolve(null);
					}
					if (err) return reject('Cannot format due to syntax errors.');
					let text = stdout.toString();
					let d = new dmp.diff_match_patch();

					let diffs = d.diff_main(document.getText(), text);
					let line = 0;
					let character = 0;
					let edits: vscode.TextEdit[] = [];
					let edit: Edit = null;

					for (let i = 0; i < diffs.length; i++) {
						let start = new vscode.Position(line, character);

						// Compute the line/character after the diff is applied.
						for (let curr = 0; curr < diffs[i][1].length; curr++) {
							if (diffs[i][1][curr] !== '\n') {
								character++;
							} else {
								character = 0;
								line++;
							}
						}

						switch (diffs[i][0]) {
							case dmp.DIFF_DELETE:
								if (edit == null) {
									edit = new Edit(EditTypes.EDIT_DELETE, start);
								} else if (edit.action !== EditTypes.EDIT_DELETE) {
									return reject('cannot format due to an internal error.');
								}
								edit.end = new vscode.Position(line, character);
								break;

							case dmp.DIFF_INSERT:
								if (edit == null) {
									edit = new Edit(EditTypes.EDIT_INSERT, start);
								} else if (edit.action === EditTypes.EDIT_DELETE) {
									edit.action = EditTypes.EDIT_REPLACE;
								}
								// insert and replace edits are all relative to the original state
								// of the document, so inserts should reset the current line/character
								// position to the start.		
								line = start.line;
								character = start.character;
								edit.text += diffs[i][1];
								break;

							case dmp.DIFF_EQUAL:
								if (edit != null) {
									edits.push(edit.apply());
									edit = null;
								}
								break;
						}
					}

					if (edit != null) {
						edits.push(edit.apply());
					}

					return resolve(edits);
				} catch (e) {
					reject(e);
				}
			});
		});
	}
}

export class GoDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
	private formatter: Formatter;

	constructor() {
		this.formatter = new Formatter();
	}

	public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
		return document.save().then(() => {
			return this.formatter.formatDocument(document);
		});
	}
}
