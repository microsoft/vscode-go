/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import dmp = require('diff-match-patch');
import { getBinPath } from './goPath'

var EDIT_DELETE = 0;
var EDIT_INSERT = 1;
var EDIT_REPLACE = 2;
class Edit {
	action: number;
	start: vscode.Position;
	end: vscode.Position;
	text: string;

	constructor(action: number, start: vscode.Position) {
		this.action = action;
		this.start = start;
		this.text = "";
	}

	apply(): vscode.TextEdit {
		switch (this.action) {
			case EDIT_INSERT:
				return vscode.TextEdit.insert(this.start, this.text);
			case EDIT_DELETE:
				return vscode.TextEdit.delete(new vscode.Range(this.start, this.end));
			case EDIT_REPLACE:
				return vscode.TextEdit.replace(new vscode.Range(this.start, this.end), this.text);
		}
	}
}

export class Formatter {
	private formatCommand = "goreturns";

	constructor() {
		let formatTool = vscode.workspace.getConfiguration('go')['formatTool'];
		if (formatTool) {
			this.formatCommand = formatTool;
		}
	}

	public formatDocument(document: vscode.TextDocument): Thenable<vscode.TextEdit[]> {
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

					var diffs = d.diff_main(document.getText(), text);
					var line = 0;
					var character = 0;
					var edits: vscode.TextEdit[] = [];
					var edit: Edit = null;

					for (var i = 0; i < diffs.length; i++) {
						var start = new vscode.Position(line, character);

						// Compute the line/character after the diff is applied.
						for (var curr = 0; curr < diffs[i][1].length; curr++) {
							if (diffs[i][1][curr] != '\n') {
								character++;
							} else {
								character = 0;
								line++;
							}
						}

						switch (diffs[i][0]) {
							case dmp.DIFF_DELETE:
								if (edit == null) {
									edit = new Edit(EDIT_DELETE, start);
								} else if (edit.action != EDIT_DELETE) {
									return reject("cannot format due to an internal error.");
								}
								edit.end = new vscode.Position(line, character);
								break;

							case dmp.DIFF_INSERT:
								if (edit == null) {
									edit = new Edit(EDIT_INSERT, start);
								} else if (edit.action == EDIT_DELETE) {
									edit.action = EDIT_REPLACE;
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
