/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/
'use strict';

import path = require('path');
import vscode = require('vscode');
import { applyCodeCoverageToAllEditors } from './goCover';
import { isModSupported } from './goModules';
import {
	extractInstanceTestName,
	findAllTestSuiteRuns,
	getBenchmarkFunctions,
	getTestFlags,
	getTestFunctionDebugArgs,
	getTestFunctions,
	getTestTags,
	goTest,
	TestConfig
} from './testUtils';
import { getTempFilePath } from './util';

// lastTestConfig holds a reference to the last executed TestConfig which allows
// the last test to be easily re-executed.
let lastTestConfig: TestConfig;

export type TestAtCursorCmd = 'debug' | 'test' | 'benchmark';

/**
 * Executes the unit test at the primary cursor using `go test`. Output
 * is sent to the 'Go' channel.
 * @param goConfig Configuration for the Go extension.
 * @param cmd Whether the command is test , benchmark or debug.
 * @param args
 */
export function testAtCursor(goConfig: vscode.WorkspaceConfiguration, cmd: TestAtCursorCmd, args: any) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return;
	}

	const getFunctions = cmd === 'benchmark' ? getBenchmarkFunctions : getTestFunctions;

	editor.document.save().then(async () => {
		try {
			const testFunctions = await getFunctions(editor.document, null);
			// We use functionName if it was provided as argument
			// Otherwise find any test function containing the cursor.
			const testFunctionName =
				args && args.functionName
					? args.functionName
					: testFunctions
							.filter((func) => func.range.contains(editor.selection.start))
							.map((el) => el.name)[0];
			if (!testFunctionName) {
				vscode.window.showInformationMessage('No test function found at cursor.');
				return;
			}

			if (cmd === 'debug') {
				await debugTestAtCursor(editor, testFunctionName, testFunctions, goConfig);
			} else if (cmd === 'benchmark' || cmd === 'test') {
				await runTestAtCursor(editor, testFunctionName, testFunctions, goConfig, cmd, args);
			} else {
				throw new Error('Unsupported command.');
			}
		} catch (err) {
			console.error(err);
		}
	});
}

/**
 * Runs the test at cursor.
 */
async function runTestAtCursor(
	editor: vscode.TextEditor,
	testFunctionName: string,
	testFunctions: vscode.DocumentSymbol[],
	goConfig: vscode.WorkspaceConfiguration,
	cmd: TestAtCursorCmd,
	args: any
) {
	const testConfigFns = [testFunctionName];
	if (cmd !== 'benchmark' && extractInstanceTestName(testFunctionName)) {
		testConfigFns.push(...findAllTestSuiteRuns(editor.document, testFunctions).map((t) => t.name));
	}

	const isMod = await isModSupported(editor.document.uri);
	const testConfig: TestConfig = {
		goConfig,
		dir: path.dirname(editor.document.fileName),
		flags: getTestFlags(goConfig, args),
		functions: testConfigFns,
		isBenchmark: cmd === 'benchmark',
		isMod,
		applyCodeCoverage: goConfig.get<boolean>('coverOnSingleTest')
	};
	// Remember this config as the last executed test.
	lastTestConfig = testConfig;
	return goTest(testConfig);
}

/**
 * Executes the sub unit test at the primary cursor using `go test`. Output
 * is sent to the 'Go' channel.
 *
 * @param goConfig Configuration for the Go extension.
 * @param cmd Whether the command is test , benchmark or debug.
 */
export function subTestAtCursor(goConfig: vscode.WorkspaceConfiguration, cmd: TestAtCursorCmd, args: any) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return;
	}

	editor.document.save().then(async () => {
		try {
			const testFunctions = await getTestFunctions(editor.document, null);
			// We use functionName if it was provided as argument
			// Otherwise find any test function containing the cursor.
			const currentTestFunctions = testFunctions.filter((func) => func.range.contains(editor.selection.start));
			const testFunctionName = args && args.functionName
				? args.functionName
				: currentTestFunctions
					.map((el) => el.name)[0];

			if (!testFunctionName) {
				vscode.window.showInformationMessage('No test function found at cursor.');
				return;
			}

			const testFunction = currentTestFunctions[0];
			const runRegex = /t.Run\("(.*)"/;
			let lineText: string;
			let match: RegExpMatchArray | null;
			for (let i = editor.selection.start.line; i >= testFunction.range.start.line; i--) {
				lineText = editor.document.lineAt(i).text;
				match = lineText.match(runRegex);
				if (match) {
					break;
				}
			}

			if (!match) {
				vscode.window.showInformationMessage('No sub test function found at cursor.');
				return;
			}

			const subTestName = testFunctionName + '/' + match[1];

			if (cmd === 'test') {
				await runTestAtCursor(editor, subTestName, testFunctions, goConfig, cmd, args);
			} else {
				throw new Error('Unsupported command.');
			}
		} catch (err) {
			console.error(err);
		}
	});
}

/**
 * Debugs the test at cursor.
 */
async function debugTestAtCursor(
	editor: vscode.TextEditor,
	testFunctionName: string,
	testFunctions: vscode.DocumentSymbol[],
	goConfig: vscode.WorkspaceConfiguration
) {
	const args = getTestFunctionDebugArgs(editor.document, testFunctionName, testFunctions);
	const tags = getTestTags(goConfig);
	const buildFlags = tags ? ['-tags', tags] : [];
	const flagsFromConfig = getTestFlags(goConfig);
	let foundArgsFlag = false;
	flagsFromConfig.forEach((x) => {
		if (foundArgsFlag) {
			args.push(x);
			return;
		}
		if (x === '-args') {
			foundArgsFlag = true;
			return;
		}
		buildFlags.push(x);
	});
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	const debugConfig: vscode.DebugConfiguration = {
		name: 'Debug Test',
		type: 'go',
		request: 'launch',
		mode: 'auto',
		program: editor.document.fileName,
		env: goConfig.get('testEnvVars', {}),
		envFile: goConfig.get('testEnvFile'),
		args,
		buildFlags: buildFlags.join(' ')
	};
	return await vscode.debug.startDebugging(workspaceFolder, debugConfig);
}

/**
 * Runs all tests in the package of the source of the active editor.
 *
 * @param goConfig Configuration for the Go extension.
 */
export async function testCurrentPackage(goConfig: vscode.WorkspaceConfiguration, isBenchmark: boolean, args: any) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}

	const isMod = await isModSupported(editor.document.uri);
	const testConfig: TestConfig = {
		goConfig,
		dir: path.dirname(editor.document.fileName),
		flags: getTestFlags(goConfig, args),
		isBenchmark,
		isMod,
		applyCodeCoverage: goConfig.get<boolean>('coverOnTestPackage')
	};
	// Remember this config as the last executed test.
	lastTestConfig = testConfig;
	return goTest(testConfig);
}

/**
 * Runs all tests from all directories in the workspace.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function testWorkspace(goConfig: vscode.WorkspaceConfiguration, args: any) {
	if (!vscode.workspace.workspaceFolders.length) {
		vscode.window.showInformationMessage('No workspace is open to run tests.');
		return;
	}
	let workspaceUri = vscode.workspace.workspaceFolders[0].uri;
	if (
		vscode.window.activeTextEditor &&
		vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
	) {
		workspaceUri = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri;
	}

	const testConfig: TestConfig = {
		goConfig,
		dir: workspaceUri.fsPath,
		flags: getTestFlags(goConfig, args),
		includeSubDirectories: true
	};
	// Remember this config as the last executed test.
	lastTestConfig = testConfig;

	isModSupported(workspaceUri).then((isMod) => {
		testConfig.isMod = isMod;
		goTest(testConfig).then(null, (err) => {
			console.error(err);
		});
	});
}

/**
 * Runs all tests in the source of the active editor.
 *
 * @param goConfig Configuration for the Go extension.
 * @param isBenchmark Boolean flag indicating if these are benchmark tests or not.
 */
export async function testCurrentFile(
	goConfig: vscode.WorkspaceConfiguration,
	isBenchmark: boolean,
	args: string[]
): Promise<boolean> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return;
	}

	const getFunctions = isBenchmark ? getBenchmarkFunctions : getTestFunctions;
	const isMod = await isModSupported(editor.document.uri);

	return editor.document
		.save()
		.then(() => {
			return getFunctions(editor.document, null).then((testFunctions) => {
				const testConfig: TestConfig = {
					goConfig,
					dir: path.dirname(editor.document.fileName),
					flags: getTestFlags(goConfig, args),
					functions: testFunctions.map((sym) => sym.name),
					isBenchmark,
					isMod,
					applyCodeCoverage: goConfig.get<boolean>('coverOnSingleTestFile')
				};
				// Remember this config as the last executed test.
				lastTestConfig = testConfig;
				return goTest(testConfig);
			});
		})
		.then(null, (err) => {
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
	goTest(lastTestConfig).then(null, (err) => {
		console.error(err);
	});
}
