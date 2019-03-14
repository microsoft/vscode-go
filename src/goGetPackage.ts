'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getImportPath, getCurrentGoPath, getBinPath, getTimeoutConfiguration } from './util';
import { outputChannel } from './goStatus';
import { buildCode } from './goBuild';

export function goGetPackage() {
	const editor = vscode.window.activeTextEditor;
	const selection = editor.selection;
	const selectedText = editor.document.lineAt(selection.active.line).text;

	const importPath = getImportPath(selectedText);
	if (importPath === '') {
		vscode.window.showErrorMessage('No import path to get');
		return;
	}

	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		return vscode.window.showErrorMessage('Could not locate Go binaries. Make sure you have Go installed');
	}

	// Set up execFile parameters
	const env = Object.assign({}, process.env, { GOPATH: getCurrentGoPath() });
	const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
	let options: { [key: string]: any } = {
		env: env,
		timeout: getTimeoutConfiguration(goConfig, 'onCommand')
	};

	cp.execFile(goRuntimePath, ['get', '-v', importPath], options, (err, stdout, stderr) => {
		// go get -v uses stderr to write output regardless of success or failure
		if (stderr !== '') {
			outputChannel.show();
			outputChannel.clear();
			outputChannel.appendLine(stderr);
			buildCode();
			return;
		}

		// go get -v doesn't write anything when the package already exists
		vscode.window.showInformationMessage(`Package already exists: ${importPath}`);
	});
}
