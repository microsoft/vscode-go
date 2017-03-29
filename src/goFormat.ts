/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { isDiffToolAvailable, getEdits, getEditsFromUnifiedDiffStr } from './diffUtils';
import { promptForMissingTool } from './goInstallTools';
import { sendTelemetryEvent, getBinPath } from './util';

export class Formatter {
	public formatDocument(document: vscode.TextDocument): Thenable<vscode.TextEdit[]> {
		return new Promise((resolve, reject) => {
			let filename = document.fileName;
			let formatTool = vscode.workspace.getConfiguration('go')['formatTool'] || 'goreturns';
			let formatCommandBinPath = getBinPath(formatTool);
			let formatFlags = vscode.workspace.getConfiguration('go')['formatFlags'] || [];
			let canFormatToolUseDiff = vscode.workspace.getConfiguration('go')['useDiffForFormatting'] && isDiffToolAvailable();
			if (canFormatToolUseDiff && formatFlags.indexOf('-d') === -1) {
				formatFlags.push('-d');
			}
			// We ignore the -w flag that updates file on disk because that would break undo feature
			if (formatFlags.indexOf('-w') > -1) {
				formatFlags.splice(formatFlags.indexOf('-w'), 1);
			}
			let t0 = Date.now();
			cp.execFile(formatCommandBinPath, [...formatFlags, filename], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool(formatTool);
						return resolve(null);
					}
					if (err) {
						console.log(err);
						return reject('Cannot format due to syntax errors.');
					};

					let textEdits: vscode.TextEdit[] = [];
					let filePatch = canFormatToolUseDiff ? getEditsFromUnifiedDiffStr(stdout)[0] : getEdits(filename, document.getText(), stdout);

					filePatch.edits.forEach((edit) => {
						textEdits.push(edit.apply());
					});

					let timeTaken = Date.now() - t0;
					sendTelemetryEvent('format', { tool:  formatTool}, {timeTaken});
					return resolve(textEdits);
				} catch (e) {
					reject('Internal issues while getting diff from formatted content');
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

// package main; import \"fmt\"; func main() {fmt.Print(\"Hello\")}
// package main; import \"fmt\"; import \"math\"; func main() {fmt.Print(\"Hello\")}
// package main; import \"fmt\"; import \"gopkg.in/Shopify/sarama.v1\"; func main() {fmt.Print(sarama.V0_10_0_0)}
