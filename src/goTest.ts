/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import util = require('util');
import { getGoRuntimePath } from './goPath';
import { GoDocumentSymbolProvider } from './goOutline';

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
}

// lastTestConfig holds a reference to the last executed TestConfig which allows
// the last test to be easily re-executed.
let lastTestConfig: TestConfig;

/**
* Executes the unit test at the primary cursor using `go test`. Output
* is sent to the 'Go' channel.
*
* @param goConfig Configuration for the Go extension.
*
* TODO: go test returns filenames with no path information for failures,
* so output doesn't produce navigable line references.
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
	getTestFunctions(editor.document).then(testFunctions => {
		let testFunction: vscode.SymbolInformation;
		// Find any test function containing the cursor.
		for (let func of testFunctions) {
			let selection = editor.selection;
			if (selection && func.location.range.contains(selection.start)) {
				testFunction = func;
				break;
			}
		};
		if (!testFunction) {
			vscode.window.setStatusBarMessage('No test function found at cursor.', 5000);
			return;
		}
		return goTest({
			goConfig: goConfig,
			dir: path.dirname(editor.document.fileName),
			flags: getTestFlags(goConfig, args),
			functions: [testFunction.name]
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
export function testCurrentPackage(goConfig: vscode.WorkspaceConfiguration, args: string[]) {
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
 * Runs go test and presents the output in the 'Go' channel.
 *
 * @param goConfig Configuration for the Go extension.
 */
function goTest(testconfig: TestConfig): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		// Remember this config as the last executed test.
		lastTestConfig = testconfig;
		outputChannel.clear();
		outputChannel.show(2, true);

		let buildTags: string = testconfig.goConfig['buildTags'];
		let args = ['test', ...testconfig.flags, '-timeout', testconfig.goConfig['testTimeout'], '-tags', buildTags];
		let testEnvVars = Object.assign({}, process.env, testconfig.goConfig['testEnvVars']);
		let goRuntimePath = getGoRuntimePath();

		if (!goRuntimePath) {
			vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
			return Promise.resolve();
		}

		if (testconfig.functions) {
			args.push('-run');
			args.push(util.format('^%s$', testconfig.functions.join('|')));
		}
		let proc = cp.spawn(goRuntimePath, args, { env: testEnvVars, cwd: testconfig.dir });
		proc.stdout.on('data', chunk => outputChannel.append(chunk.toString()));
		proc.stderr.on('data', chunk => outputChannel.append(chunk.toString()));
		proc.on('close', code => {
			if (code) {
				outputChannel.append('Error: Tests failed.');
			} else {
				outputChannel.append('Success: Tests passed.');
			}
			resolve(code === 0);
		});
	});
}

/**
 * Returns all Go unit test functions in the given source file.
 *
 * @param the URI of a Go source file.
 * @return test function symbols for the source file.
 */
function getTestFunctions(doc: vscode.TextDocument): Thenable<vscode.SymbolInformation[]> {
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
	let testFlags = goConfig['testFlags'] ? goConfig['testFlags'] : ['-v', ...goConfig['buildFlags']];
	return (args && args.hasOwnProperty('flags') && Array.isArray(args['flags'])) ? args['flags'] : testFlags;
}