/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { parseDiffOutput } from '../src/diffUtils';
import { getBinPath } from './goPath';
import { promptForMissingTool } from './goInstallTools';

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
			let formatFlags = vscode.workspace.getConfiguration('go')['formatFlags'] || [];
			formatFlags.push('-d');

			cp.execFile(formatCommandBinPath, [...formatFlags, filename], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool(formatCommandBinPath);
						return resolve(null);
					}
					if (err) return reject('Cannot format due to syntax errors.');

					let textEdits: vscode.TextEdit[] = [];
					let filePatches = parseDiffOutput(stdout);

					filePatches[0].edits.forEach((edit) => {
						textEdits.push(edit.apply());
					});

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
