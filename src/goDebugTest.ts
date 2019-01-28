'use strict';

import vscode = require('vscode');
import { getTestFunctions, extractInstanceTestName, findAllTestSuiteRuns, getTestFunctionDebugArgs } from './testUtils';

/**
* Debugs the unit test at the primary cursor. Output
* is sent to the 'Go' channel.
*
* @param goConfig Configuration for the Go extension.
*/
export function debugTestAtCursor(goConfig: vscode.WorkspaceConfiguration, args: any) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return;
	}

	editor.document.save().then(() => {
		return getTestFunctions(editor.document, null).then(testFunctions => {
			// We use functionName if it was provided as argument
			// Otherwise find any test function containing the cursor.
			const testFunctionName = args && args.functionName
				? args.functionName
				: testFunctions.find(func => func.location.range.contains(editor.selection.start)).name;

			if (!testFunctionName) {
				vscode.window.showInformationMessage('No test function found at cursor.');
				return;
			}

			const dbgArgs = getTestFunctionDebugArgs(editor.document, testFunctionName, testFunctions);
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
			const debugConfig: vscode.DebugConfiguration = {
				name: 'Debug Test',
				type: 'go',
				request: 'launch',
				mode: 'auto',
				program: editor.document.fileName,
				env: goConfig.get('testEnvVars', {}),
				envFile: goConfig.get('testEnvFile'),
				args: dbgArgs
			};

			return vscode.debug.startDebugging(workspaceFolder, debugConfig);
		}).then(null, err => {
			console.log(err);
		});
	});
}