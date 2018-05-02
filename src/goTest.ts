/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import path = require('path');
import vscode = require('vscode');
import os = require('os');
import { goTest, TestConfig, getTestFlags, getTestFunctions, getBenchmarkFunctions } from './testUtils';
import { getCoverage } from './goCover';

// lastTestConfig holds a reference to the last executed TestConfig which allows
// the last test to be easily re-executed.
let lastTestConfig: TestConfig;

/**
* Executes the unit test at the primary cursor using `go test`. Output
* is sent to the 'Go' channel.
*
* @param goConfig Configuration for the Go extension.
*/
export function testAtCursor(goConfig: vscode.WorkspaceConfiguration, isBenchmark: boolean, args: any) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return;
	}

	const getFunctions = isBenchmark ? getBenchmarkFunctions : getTestFunctions;

	const {tmpCoverPath, testFlags } = makeCoverData(goConfig, 'coverOnSingleTest', args);

	editor.document.save().then(() => {
		return getFunctions(editor.document, null).then(testFunctions => {
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
				};
			}

			if (!testFunctionName) {
				vscode.window.showInformationMessage('No test function found at cursor.');
				return;
			}

			const testConfig = {
				goConfig: goConfig,
				dir: path.dirname(editor.document.fileName),
				flags: testFlags,
				functions: [testFunctionName],
				isBenchmark: isBenchmark,
				showTestCoverage: true
			};

			// Remember this config as the last executed test.
			lastTestConfig = testConfig;

			return goTest(testConfig);
		});
	}).then(success => {
		if (success && tmpCoverPath) {
			return getCoverage(tmpCoverPath);
		}
	}, err => {
		console.error(err);
	});
}

/**
 * Runs all tests in the package of the source of the active editor.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function testCurrentPackage(goConfig: vscode.WorkspaceConfiguration, args: any) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}

	const {tmpCoverPath, testFlags } = makeCoverData(goConfig, 'coverOnTestPackage', args);

	const testConfig = {
		goConfig: goConfig,
		dir: path.dirname(editor.document.fileName),
		flags: testFlags,
		showTestCoverage: true
	};
	// Remember this config as the last executed test.
	lastTestConfig = testConfig;

	goTest(testConfig).then(success => {
		if (success && tmpCoverPath) {
			return getCoverage(tmpCoverPath);
		}
	}, err => {
		console.log(err);
	});
}

/**
 * Runs all tests from all directories in the workspace.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function testWorkspace(goConfig: vscode.WorkspaceConfiguration, args: any) {
	let dir = vscode.workspace.rootPath;
	if (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) {
		dir = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri.fsPath;
	}
	if (!dir) {
		vscode.window.showInformationMessage('No workspace is open to run tests.');
		return;
	}
	const testConfig = {
		goConfig: goConfig,
		dir: dir,
		flags: getTestFlags(goConfig, args),
		includeSubDirectories: true
	};
	// Remember this config as the last executed test.
	lastTestConfig = testConfig;

	goTest(testConfig).then(null, err => {
		console.error(err);
	});
}

/**
 * Runs all tests in the source of the active editor.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function testCurrentFile(goConfig: vscode.WorkspaceConfiguration, args: string[]): Thenable<boolean> {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return;
	}

	return editor.document.save().then(() => {
		return getTestFunctions(editor.document, null).then(testFunctions => {
			const testConfig = {
				goConfig: goConfig,
				dir: path.dirname(editor.document.fileName),
				flags: getTestFlags(goConfig, args),
				functions: testFunctions.map(func => { return func.name; })
			};
			// Remember this config as the last executed test.
			lastTestConfig = testConfig;

			return goTest(testConfig);
		});
	}).then(null, err => {
		console.error(err);
		return Promise.resolve(false);
	});
}

/**
 * Runs the previously executed test.
 */
export function testPrevious() {
	if (!lastTestConfig) {
		vscode.window.showInformationMessage('No test has been recently executed.');
		return;
	}
	goTest(lastTestConfig).then(null, err => {
		console.error(err);
	});
}

/**
 * Computes the tmp coverage path and needed flags.
 *
 * @param goConfig Configuration for the Go extension.
 */
function makeCoverData(goConfig: vscode.WorkspaceConfiguration, confFlag: string, args: any): { tmpCoverPath: string, testFlags: string[] } {
	let tmpCoverPath = '';
	let testFlags = getTestFlags(goConfig, args) || [];
	if (goConfig[confFlag] === true) {
		tmpCoverPath = path.normalize(path.join(os.tmpdir(), 'go-code-cover'));
		testFlags.push('-coverprofile=' + tmpCoverPath);
	}

	return {tmpCoverPath, testFlags};
}
