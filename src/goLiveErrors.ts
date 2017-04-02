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

export function goLiveErrorsEnabled() {
	let goConfig = <GoLiveErrorsConfig>vscode.workspace.getConfiguration('go')['liveErrors'];
	if (goConfig === null || goConfig === undefined || !goConfig.enabled) {
		return false;
	}
	let autoSave = vscode.workspace.getConfiguration('files')['autoSave'];
	if (autoSave !== null && autoSave !== undefined && autoSave !== 'off') {
		return false;
	}
	return goConfig.enabled;
}

// parseLiveFile runs the gotype command in live mode to check for any syntactic or
// semantic errors and reports them immediately
export function parseLiveFile(e: vscode.TextDocumentChangeEvent) {
	if (e.document.isUntitled) {
		return;
	}
	if (e.document.languageId !== 'go') {
		return;
	}
	if (!goLiveErrorsEnabled()) {
		return;
	}

	if (runner != null) {
		clearTimeout(runner);
	}
	runner = setTimeout(function(){
		processFile(e);
		runner = null;
	}, vscode.workspace.getConfiguration('go')['liveErrors']['delay']);
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

		// we want to take the error path here because the command we are calling
		// returns a non-zero exit status if the checks fail
		let newDiagnostics = [];
		if (!newDiagnostics) {
			newDiagnostics = [];
		}

		// grab a copy of the existing diagnostics that are being reported for the
		// current file
		let oldDiagnostics = diagnosticCollection.get(uri);

		// delete the existing diagnostics for the current file
		//
		// error-level diagnostics will be reported by this process, so we want to
		// clear out the existing errors to avoid getting duplicates
		diagnosticCollection.delete(uri);

		// we want to keep all non-error level diagnostics that were previously
		// reported, so add them back in
		oldDiagnostics.forEach((value) => {
			if (value.severity !== vscode.DiagnosticSeverity.Error) {
				newDiagnostics.push(value);
			}
		});

		if (err) {
			stderr.split('\n').forEach(error => {
				if (error === null || error.length === 0) {
					return;
				}
				// extract the line, column and error message from the gotype output
				let [_, line, column, message] = /^.+:(\d+):(\d+):\s+(.+)/.exec(error);

				let range = new vscode.Range(+line - 1, +column, +line - 1, +column);
				let diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
				newDiagnostics.push(diagnostic);
			});
		}
		diagnosticCollection.set(uri, newDiagnostics);
	});
	p.stdin.end(fileContents);
}
