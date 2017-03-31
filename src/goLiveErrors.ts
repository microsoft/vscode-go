'use strict';

import vscode = require('vscode');
import { byteOffsetAt, getBinPath } from './util';
import cp = require('child_process');
import path = require('path');
import { promptForMissingTool } from './goInstallTools';
import { diagnosticCollection } from './goMain';

// Interface for settings configuration for adding and removing tags
interface GoLiveErrorsConfig {
	delay: number;
	enabled: boolean;
}

let runner;

// parseLiveFile runs the gotype command in live mode to check for any syntactic or
// semantic errors and reports them immediately
export function parseLiveFile(e: vscode.TextDocumentChangeEvent) {
	if (e.document.isUntitled) {
		return;
	}
	if (e.document.languageId !== 'go') {
		return;
	}

	let config = <GoLiveErrorsConfig>vscode.workspace.getConfiguration('go')['liveErrors'];
	if (config == null || !config.enabled) {
		return;
	}

	if (runner != null) {
		clearTimeout(runner);
	}
	runner = setTimeout(function(){
		processFile(e);
		runner = null;
	}, config.delay);
}

// processFile does the actual work once the timeout has fired
function processFile(e: vscode.TextDocumentChangeEvent) {
	let uri = e.document.uri;
	let gotypeLive = getBinPath('gotype-live');
	let fileContents = e.document.getText();
	let fileName = e.document.fileName;
	let args = ['-e', '-a', '-lf=' + fileName, path.dirname(fileName)];
	let p = cp.execFile(gotypeLive, args, (err, stdout, stderr) => {
		if (err && (<any>err).code === 'ENOENT') {
			promptForMissingTool('gotype-live');
			return;
		}

		diagnosticCollection.clear();
		if (err) {
			// we want to take the error path here because the command we are calling
			// returns a non-zero exit status if the checks fail
			let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();

			stderr.split('\n').forEach(error => {
				if (error === null || error.length === 0) {
					return;
				}
				// extract the line, column and error message from the gotype output
				let [_, line, column, message] = /^.+:(\d+):(\d+):\s+(.+)/.exec(error);

				let range = new vscode.Range(+line - 1, +column, +line - 1, +column);
				let diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
				let diagnostics = diagnosticMap.get(uri.toString());
				if (!diagnostics) {
					diagnostics = [];
				}
				diagnostics.push(diagnostic);
				diagnosticMap.set(uri.toString(), diagnostics);
			});
			diagnosticMap.forEach((diags, file) => {
				diagnosticCollection.set(vscode.Uri.parse(file), diags);
			});
			return;
		}
	});
	p.stdin.end(fileContents);
}
