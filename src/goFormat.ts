/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';
import { sendTelemetryEventForFormatting } from './telemetry';
import { getBinPath, getGoConfig, getToolsEnvVars, killTree } from './util';

export class GoDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
	public provideDocumentFormattingEdits(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.TextEdit[]> {
		if (vscode.window.visibleTextEditors.every((e) => e.document.fileName !== document.fileName)) {
			return [];
		}

		const filename = document.fileName;
		const goConfig = getGoConfig(document.uri);
		const formatTool = goConfig['formatTool'] || 'goreturns';
		const formatFlags = goConfig['formatFlags'].slice() || [];

		// We ignore the -w flag that updates file on disk because that would break undo feature
		if (formatFlags.indexOf('-w') > -1) {
			formatFlags.splice(formatFlags.indexOf('-w'), 1);
		}

		// Fix for https://github.com/Microsoft/vscode-go/issues/613 and https://github.com/Microsoft/vscode-go/issues/630
		if (formatTool === 'goimports' || formatTool === 'goreturns') {
			formatFlags.push('-srcdir', filename);
		}

		// Since goformat supports the style flag, set tabsize if user has not passed any flags
		if (formatTool === 'goformat' && formatFlags.length === 0 && options.insertSpaces) {
			formatFlags.push('-style=indent=' + options.tabSize);
		}

		return this.runFormatter(formatTool, formatFlags, document, token).then(
			(edits) => edits,
			(err) => {
				if (typeof err === 'string' && err.startsWith('flag provided but not defined: -srcdir')) {
					promptForUpdatingTool(formatTool);
					return Promise.resolve([]);
				}
				if (err) {
					console.log(err);
					return Promise.reject('Check the console in dev tools to find errors when formatting.');
				}
			}
		);
	}

	private runFormatter(
		formatTool: string,
		formatFlags: string[],
		document: vscode.TextDocument,
		token: vscode.CancellationToken
	): Thenable<vscode.TextEdit[]> {
		const formatCommandBinPath = getBinPath(formatTool);

		return new Promise<vscode.TextEdit[]>((resolve, reject) => {
			if (!path.isAbsolute(formatCommandBinPath)) {
				promptForMissingTool(formatTool);
				return reject();
			}

			const t0 = Date.now();
			const env = getToolsEnvVars();
			const cwd = path.dirname(document.fileName);
			let stdout = '';
			let stderr = '';

			// Use spawn instead of exec to avoid maxBufferExceeded error
			const p = cp.spawn(formatCommandBinPath, formatFlags, { env, cwd });
			token.onCancellationRequested(() => !p.killed && killTree(p.pid));
			p.stdout.setEncoding('utf8');
			p.stdout.on('data', (data) => (stdout += data));
			p.stderr.on('data', (data) => (stderr += data));
			p.on('error', (err) => {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool(formatTool);
					return reject();
				}
			});
			p.on('close', (code) => {
				if (code !== 0) {
					return reject(stderr);
				}

				// Return the complete file content in the edit.
				// VS Code will calculate minimal edits to be applied
				const fileStart = new vscode.Position(0, 0);
				const fileEnd = document.lineAt(document.lineCount - 1).range.end;
				const textEdits: vscode.TextEdit[] = [
					new vscode.TextEdit(new vscode.Range(fileStart, fileEnd), stdout)
				];

				const timeTaken = Date.now() - t0;
				sendTelemetryEventForFormatting(formatTool, timeTaken);
				if (timeTaken > 750) {
					console.log(`Formatting took too long(${timeTaken}ms). Format On Save feature could be aborted.`);
				}
				return resolve(textEdits);
			});
			if (p.pid) {
				p.stdin.end(document.getText());
			}
		});
	}
}
