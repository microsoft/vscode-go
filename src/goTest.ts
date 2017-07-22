/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import util = require('util');
import os = require('os');
import { parseEnvFile, getGoRuntimePath, resolvePath } from './goPath';
import { getToolsEnvVars } from './util';
import { GoDocumentSymbolProvider } from './goOutline';
import { getNonVendorPackages } from './goPackages';

let outputChannel = vscode.window.createOutputChannel('Go Tests');

/**
 * Input to goTest.
 */
interface TestConfig {
	/**
	 * The working directory for `go test`.
	 */
	dir: string;
	/**
	 * Configuration for the Go extension
	 */
	goConfig: vscode.WorkspaceConfiguration;
	/**
	 * Test flags to override the testFlags and buildFlags from goConfig.
	 */
	flags: string[];
	/**
	 * Specific function names to test.
	 */
	functions?: string[];
	/**
	 * Test was not requested explicitly. The output should not appear in the UI.
	 */
	background?: boolean;
	/**
	 * Run all tests from all sub directories under `dir`
	 */
	includeSubDirectories?: boolean;
}

// lastTestConfig holds a reference to the last executed TestConfig which allows
// the last test to be easily re-executed.
let lastTestConfig: TestConfig;

/**
* Executes the unit test at the primary cursor using `go test`. Output
* is sent to the 'Go' channel.
*
* @param goConfig Configuration for the Go extension.
*/
export function testAtCursor(goConfig: vscode.WorkspaceConfiguration, args: any) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('_test.go')) {
		vscode.window.showInformationMessage('No tests found. Current file is not a test file.');
		return;
	}
	if (editor.document.isDirty) {
		vscode.window.showInformationMessage('File has unsaved changes. Save and try again.');
		return;
	}
	getTestFunctions(editor.document).then(testFunctions => {
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

		return goTest({
			goConfig: goConfig,
			dir: path.dirname(editor.document.fileName),
			flags: getTestFlags(goConfig, args),
			functions: [ testFunctionName ]
		});
	}).then(null, err => {
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
	goTest({
		goConfig: goConfig,
		dir: path.dirname(editor.document.fileName),
		flags: getTestFlags(goConfig, args)
	}).then(null, err => {
		console.error(err);
	});
}

/**
 * Runs all tests from all directories in the workspace.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function testWorkspace(goConfig: vscode.WorkspaceConfiguration, args: any) {
	goTest({
		goConfig: goConfig,
		dir: vscode.workspace.rootPath,
		flags: getTestFlags(goConfig, args),
		includeSubDirectories: true
	}).then(null, err => {
		console.error(err);
	});
}

export function getTestEnvVars(config: vscode.WorkspaceConfiguration): any {
	const toolsEnv = getToolsEnvVars();
	const testEnv = config['testEnvVars'] || {};

	let fileEnv = {};
	let testEnvFile = config['testEnvFile'];
	if (testEnvFile) {
		testEnvFile = resolvePath(testEnvFile, vscode.workspace.rootPath);
		try {
			fileEnv = parseEnvFile(testEnvFile);
		} catch (e) {
			console.log(e);
		}
	}

	return Object.assign({}, toolsEnv, fileEnv, testEnv);
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
	return getTestFunctions(editor.document).then(testFunctions => {
		return goTest({
			goConfig: goConfig,
			dir: path.dirname(editor.document.fileName),
			flags: getTestFlags(goConfig, args),
			functions: testFunctions.map(func => { return func.name; })
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
	let editor = vscode.window.activeTextEditor;
	if (!lastTestConfig) {
		vscode.window.showInformationMessage('No test has been recently executed.');
		return;
	}
	goTest(lastTestConfig).then(null, err => {
		console.error(err);
	});
}

/**
 * Reveals the output channel in the UI.
 */
export function showTestOutput() {
	outputChannel.show(true);
}

/**
 * Runs go test and presents the output in the 'Go' channel.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function goTest(testconfig: TestConfig): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		outputChannel.clear();
		if (!testconfig.background) {
			// Remember this config as the last executed test.
			lastTestConfig = testconfig;
			outputChannel.show(true);
		}

		let buildTags: string = testconfig.goConfig['buildTags'];
		let args = ['test', ...testconfig.flags, '-timeout', testconfig.goConfig['testTimeout'], '-tags', buildTags];
		let testEnvVars = getTestEnvVars(testconfig.goConfig);
		let goRuntimePath = getGoRuntimePath();

		if (!goRuntimePath) {
			vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
			return Promise.resolve();
		}

		targetArgs(testconfig).then(targets => {
			let outTargets = args.slice(0);
			if (targets.length > 2) {
				outTargets.push('<long arguments omitted>');
			} else {
				outTargets.push(...targets);
			}
			outputChannel.appendLine(['Running tool:', goRuntimePath, ...outTargets].join(' '));
			outputChannel.appendLine('');

			args.push(...targets);
			let proc = cp.spawn(goRuntimePath, args, { env: testEnvVars, cwd: testconfig.dir });
			proc.stdout.on('data', chunk => {
				let testOutput = expandFilePathInOutput(chunk.toString(), testconfig.dir);
				outputChannel.append(testOutput);

			});
			proc.stderr.on('data', chunk => outputChannel.append(chunk.toString()));
			proc.on('close', code => {
				if (code) {
					outputChannel.append('Error: Tests failed.');
				} else {
					outputChannel.append('Success: Tests passed.');
				}
				resolve(code === 0);
			});
		}, err => {
			outputChannel.appendLine('Error: Tests failed.');
			outputChannel.appendLine(err);
			resolve(false);
		});
	});
}

/**
 * Returns all Go unit test functions in the given source file.
 *
 * @param the URI of a Go source file.
 * @return test function symbols for the source file.
 */
export function getTestFunctions(doc: vscode.TextDocument): Thenable<vscode.SymbolInformation[]> {
	let documentSymbolProvider = new GoDocumentSymbolProvider();
	return documentSymbolProvider
		.provideDocumentSymbols(doc, null)
		.then(symbols =>
			symbols.filter(sym =>
				sym.kind === vscode.SymbolKind.Function
				&& hasTestFunctionPrefix(sym.name))
		);
}

/**
 * Returns whether a given function name has a test prefix.
 * Test functions have "Test" or "Example" as a prefix.
 *
 * @param the function name.
 * @return whether the name has a test function prefix.
 */
function hasTestFunctionPrefix(name: string): boolean {
	return name.startsWith('Test') || name.startsWith('Example');
}

function getTestFlags(goConfig: vscode.WorkspaceConfiguration, args: any): string[] {
	let testFlags = goConfig['testFlags'] ? goConfig['testFlags'] : goConfig['buildFlags'];
	return (args && args.hasOwnProperty('flags') && Array.isArray(args['flags'])) ? args['flags'] : testFlags;
}

function expandFilePathInOutput(output: string, cwd: string): string {
	let lines = output.split('\n');
	for (let i = 0; i < lines.length; i++) {
		let matches = lines[i].match(/^\s+(\S+_test.go):(\d+):/);
		if (matches) {
			lines[i] = lines[i].replace(matches[1], path.join(cwd, matches[1]));
		}
	}
	return lines.join('\n');
}

/**
 * Get the test target arguments.
 *
 * @param testconfig Configuration for the Go extension.
 */
function targetArgs(testconfig: TestConfig): Thenable<Array<string>> {
	if (testconfig.functions) {
		return new Promise<Array<string>>((resolve, reject) => {
			const args = [];
			args.push('-run');
			args.push(util.format('^%s$', testconfig.functions.join('|')));
			return resolve(args);
		});
	} else if (testconfig.includeSubDirectories) {
		return getNonVendorPackages(vscode.workspace.rootPath);
	}
	return Promise.resolve([]);
}
