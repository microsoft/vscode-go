'use strict';

import vscode = require('vscode');
import { getBinPath, getToolsEnvVars } from './util';
import cp = require('child_process');
import path = require('path');
import { promptForMissingTool } from './goInstallTools';
import { errorDiagnosticCollection } from './goMain';

// Interface for settings configuration for adding and removing tags
interface GoLiveErrorsConfig {
	delay: number;
	enabled: boolean;
}

let runner;

export function goLiveErrorsEnabled() {
	let goConfig = <GoLiveErrorsConfig>vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null)['liveErrors'];
	if (goConfig === null || goConfig === undefined || !goConfig.enabled) {
		return false;
	}
	let files = vscode.workspace.getConfiguration('files');
	let autoSave = files['autoSave'];
	let autoSaveDelay = files['autoSaveDelay'];
	if (autoSave !== null && autoSave !== undefined &&
			autoSave === 'afterDelay' && autoSaveDelay < goConfig.delay * 1.5) {
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
	}, vscode.workspace.getConfiguration('go', e.document.uri)['liveErrors']['delay']);
}

// processFile does the actual work once the timeout has fired
function processFile(e: vscode.TextDocumentChangeEvent) {
	const gotypeLive = getBinPath('gotype-live');
	if (!path.isAbsolute(gotypeLive)) {
		return promptForMissingTool('gotype-live');
	}

	let fileContents = e.document.getText();
	let fileName = e.document.fileName;
	let args = ['-e', '-a', '-lf=' + fileName, path.dirname(fileName)];
	let env = getToolsEnvVars();
	let p = cp.execFile(gotypeLive, args, {env}, (err, stdout, stderr) => {
		if (err && (<any>err).code === 'ENOENT') {
			promptForMissingTool('gotype-live');
			return;
		}

		errorDiagnosticCollection.clear();

		if (err) {
			// we want to take the error path here because the command we are calling
			// returns a non-zero exit status if the checks fail
			let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();

			stderr.split('\n').forEach(error => {
				if (error === null || error.length === 0) {
					return;
				}
				// extract the line, column and error message from the gotype output
				let [_, file, line, column, message] = /^(.+):(\d+):(\d+):\s+(.+)/.exec(error);
				// get cannonical file path
				file = vscode.Uri.file(file).toString();
				let range = new vscode.Range(+line - 1, +column, +line - 1, +column);
				let diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);

				let diagnostics = diagnosticMap.get(file);
				if (!diagnostics) {
					diagnostics = [];
				}
				diagnostics.push(diagnostic);
				diagnosticMap.set(file, diagnostics);
			});

			diagnosticMap.forEach((diagnostics, file) => {
				errorDiagnosticCollection.set(vscode.Uri.parse(file), diagnostics);
			});
		}
	});
	p.stdin.end(fileContents);
}
