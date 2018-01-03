/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { promptForMissingTool } from './goInstallTools';
import { sendTelemetryEvent, getBinPath, getToolsEnvVars } from './util';

const missingToolMsg = 'Missing tool: ';

export class Formatter {
	public formatDocument(document: vscode.TextDocument): Thenable<vscode.TextEdit[]> {
		return new Promise((resolve, reject) => {
			let filename = document.fileName;
			let goConfig = vscode.workspace.getConfiguration('go', document.uri);
			let formatTool = goConfig['formatTool'] || 'goreturns';
			let formatCommandBinPath = getBinPath(formatTool);
			let formatFlags = goConfig['formatFlags'].slice() || [];

			// We ignore the -w flag that updates file on disk because that would break undo feature
			if (formatFlags.indexOf('-w') > -1) {
				formatFlags.splice(formatFlags.indexOf('-w'), 1);
			}

			// Fix for https://github.com/Microsoft/vscode-go/issues/613 and https://github.com/Microsoft/vscode-go/issues/630
			if (formatTool === 'goimports') {
				formatFlags.push('-srcdir', filename);
			}

			let t0 = Date.now();
			let env = getToolsEnvVars();
			let stdout = '';
			let stderr = '';
			const p = cp.spawn(formatCommandBinPath, formatFlags, { env });
			p.stdout.on('data', data => stdout += data);
			p.stderr.on('data', data => stderr += data);
			p.on('error', err => {
				if (!err) {
					return reject();
				}
				if ((<any>err).code === 'ENOENT') {
					return reject(missingToolMsg + formatTool);
				}
				console.log(err.message || stderr);
				return reject('Check the console in dev tools to find errors when formatting.');
			});
			p.on('close', code => {
				if (code !== 0) {
					return reject(stderr);
				}
				const fileStart = new vscode.Position(0, 0);
				const fileEnd = document.lineAt(document.lineCount - 1).range.end;
				const textEdits: vscode.TextEdit[] = [new vscode.TextEdit(new vscode.Range(fileStart, fileEnd), stdout)];
				let timeTaken = Date.now() - t0;
				/* __GDPR__
				   "format" : {
					  "tool" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					  "timeTaken": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
				   }
				 */
				sendTelemetryEvent('format', { tool: formatTool }, { timeTaken });
				if (timeTaken > 750) {
					console.log(`Formatting took too long(${timeTaken}ms). Format On Save feature could be aborted.`);
				}
				return resolve(textEdits);
			});
			p.stdin.end(document.getText());
		});
	}
}

export class GoDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
	private formatter: Formatter;

	constructor() {
		this.formatter = new Formatter();
	}

	public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
		return this.formatter.formatDocument(document).then(null, err => {
			// Prompt for missing tool is located here so that the
			// prompts dont show up when formatting is run on save
			if (typeof err === 'string' && err.startsWith(missingToolMsg)) {
				promptForMissingTool(err.substr(missingToolMsg.length));
			} else {
				console.log(err);
			}
			return [];
		});
	}
}

// package main; import \"fmt\"; func main() {fmt.Print(\"Hello\")}
// package main; import \"fmt\"; import \"math\"; func main() {fmt.Print(\"Hello\")}
// package main; import \"fmt\"; import \"gopkg.in/Shopify/sarama.v1\"; func main() {fmt.Print(sarama.V0_10_0_0)}
