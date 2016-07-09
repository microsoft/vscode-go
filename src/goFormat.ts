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
import { EditTypes, Edit, GetEditsFromDiffs } from './util';

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
					let edits: Edit[] = GetEditsFromDiffs(diffs, 0);
					let textEdits: vscode.TextEdit[] = [];

					if (!edits){
						return reject('Cannot format due to internal errors');
					}

					for (let i = 0; i < diffs.length; i++) {
						textEdits.push(edits[i].apply());
					}

					return resolve(textEdits);
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
