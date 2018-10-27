'use strict';

import vscode = require('vscode');
import { getTestFunctions } from './testUtils';

/**
* Debugs the unit test at the primary cursor. Output
* is sent to the 'Go' channel.
*
* @param goConfig Configuration for the Go extension.
*/
export function debugTestAtCursor(goConfig: vscode.WorkspaceConfiguration, args: any) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return;
	}

	getTestFunctions(editor.document, null).then(testFunctions => {
		let testFunctionName: string;

		// We use functionName if it was provided as argument
		// Otherwise find any test function containing the cursor.
		if (args && args.functionName) {
			testFunctionName = args.functionName;
		} else {
			for (let func of testFunctions) {
				let selection = editor.selection;
				if (selection && func.location.range.contains(selection.start)) {
					testFunctionName = func.name;
					break;
				}
			}
		}

		if (!testFunctionName) {
			vscode.window.showInformationMessage('No test function found at cursor.');
			return;
		}

		const configArgs = ['-test.run', testFunctionName];
		const env = goConfig['testEnvVars'] || {};
		const envFile = goConfig['testEnvFile'];

		let workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
		let debugConfig: vscode.DebugConfiguration = {
			'name': 'Debug Test',
			'type': 'go',
			'request': 'launch',
			'mode': 'auto',
			'program': editor.document.fileName,
			'env': env,
			'envFile': envFile,
			'args': configArgs
		};

		return vscode.debug.startDebugging(workspaceFolder, debugConfig);
	}).then(null, err => {
		console.log(err);
	});
}