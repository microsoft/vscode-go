'use strict';

import vscode = require('vscode');
import { getBinPath, getToolsEnvVars, getTimeoutConfiguration } from './util';
import cp = require('child_process');
import path = require('path');
import { promptForMissingTool } from './goInstallTools';
import { buildDiagnosticCollection } from './goMain';

// Interface for settings configuration for adding and removing tags
interface GoLiveErrorsConfig {
	delay: number;
	enabled: boolean;
}

let runner: NodeJS.Timer;

export function goLiveErrorsEnabled() {
	const goConfig = <GoLiveErrorsConfig>vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null)['liveErrors'];
	if (goConfig === null || goConfig === undefined || !goConfig.enabled) {
		return false;
	}
	const files = vscode.workspace.getConfiguration('files');
	const autoSave = files['autoSave'];
	const autoSaveDelay = files['autoSaveDelay'];
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
	runner = setTimeout(() => {
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

	const fileContents = e.document.getText();
	const fileName = e.document.fileName;
	const args = ['-e', '-a', '-lf=' + fileName, path.dirname(fileName)];

	// Set up execFile parameters
	const options: { [key: string]: any } = {
		env: getToolsEnvVars(),
		timeout: getTimeoutConfiguration('onType')
	};

	const p = cp.execFile(gotypeLive, args, options, (err, stdout, stderr) => {
		if (err && (<any>err).code === 'ENOENT') {
			promptForMissingTool('gotype-live');
			return;
		}

		buildDiagnosticCollection.clear();

		if (err) {
			// we want to take the error path here because the command we are calling
			// returns a non-zero exit status if the checks fail
			const diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();

			stderr.split('\n').forEach(error => {
				if (error === null || error.length === 0) {
					return;
				}
				// extract the line, column and error message from the gotype output
				const [_, file, line, column, message] = /^(.+):(\d+):(\d+):\s+(.+)/.exec(error);
				// get canonical file path
				const canonicalFilePath = vscode.Uri.file(file).toString();
				const range = new vscode.Range(+line - 1, +column, +line - 1, +column);
				const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
				diagnostic.source = 'go';

				const diagnostics = diagnosticMap.get(canonicalFilePath) || [];
				diagnostics.push(diagnostic);
				diagnosticMap.set(canonicalFilePath, diagnostics);
			});

			diagnosticMap.forEach((diagnostics, file) => {
				buildDiagnosticCollection.set(vscode.Uri.parse(file), diagnostics);
			});
		}
	});
	if (p.pid) {
		p.stdin.end(fileContents);
	}
}
