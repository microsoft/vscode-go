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
import { getGoRuntimePath } from './goPath';
import { GoDocumentSymbolProvider } from './goOutline';
import { outputChannel } from './goStatus';

let runningProcess = {};
/**
 * Input to goTest.
 */
interface TestConfig {
	/**
	 * The working directory for `go test`.
	 */
	dir: string;
	/**
	 * The timeout for tests (in ParseDuration format.)
	 */
	timeout: string;
	/**
	 * Specific function names to test.
	 */
	functions?: string[];
}

/**
* Executes the unit test at the primary cursor using `go test`. Output
* is sent to the 'Go' channel.
* 
* @param timeout a ParseDuration formatted timeout string for the tests.
*
* TODO: go test returns filenames with no path information for failures,
* so output doesn't produce navigable line references.
*/
export function testAtCursor(timeout: string) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
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
			timeout: timeout,
			dir: path.dirname(editor.document.fileName),
			functions: [testFunction.name]
		});
	}).then(null, err => {
		console.error(err);
	});
}

/**
* Executes the unit test or main at the primary cursor using `go run/test`. Output
* is sent to the 'Go' channel.
* 
* @param timeout a ParseDuration formatted timeout string for the tests.
*
* TODO: go test returns filenames with no path information for failures,
* so output doesn't produce navigable line references.
*/
export function runAtCursor(timeout: string) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	isMainPackage(editor.document).then(ismain => {
		if (ismain) {
			goRunMain(editor.document.fileName);
		} else {
			testAtCursor(timeout);
		}
	}, err => {
		console.error(err);
	});
}

/**
 * Runs all tests in the package of the source of the active editor.
 *
 * @param timeout a ParseDuration formatted timeout string for the tests.
 */
export function testCurrentPackage(timeout: string) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	goTest({
		timeout: timeout,
		dir: path.dirname(editor.document.fileName)
	}).then(null, err => {
		console.error(err);
	});
}

/**
 * Runs all tests in the source of the active editor.
 *
 * @param timeout a ParseDuration formatted timeout string for the tests.
 */
export function testCurrentFile(timeout: string) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	getTestFunctions(editor.document).then(testFunctions => {
		return goTest({
			timeout: timeout,
			dir: path.dirname(editor.document.fileName),
			functions: testFunctions.map(func => { return func.name; })
		});
	}).then(null, err => {
		console.error(err);
	});
}

/**
 * Kill all running go task.
 *
 */
export function killRunning() {
	for (let name in runningProcess) {
		if (runningProcess.hasOwnProperty(name)) {
			if (os.platform() === 'win32') {
				cp.exec('taskkill /F /IM ' + name);
			} else {
				cp.exec('killall ' + name);
			}
		}
	}
}

/**
 * Runs go test and presents the output in the 'Go' channel.
 *
 * @param config the test execution configuration.
 */
function goTest(config: TestConfig): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		outputChannel.clear();
		outputChannel.show(2);
		let buildFlags: string[] = vscode.workspace.getConfiguration('go')['buildFlags'];
		let buildTags: string = vscode.workspace.getConfiguration('go')['buildTags'];
		let args = ['test', '-v', '-timeout', config.timeout, '-tags', buildTags, ...buildFlags];

		if (config.functions) {
			args.push('-run');
			args.push(util.format('^%s$', config.functions.join('|')));
		}
		let proc = cp.spawn(getGoRuntimePath(), args, { env: process.env, cwd: config.dir });
		proc.stdout.on('data', chunk => outputChannel.append(chunk.toString()));
		proc.stderr.on('data', chunk => outputChannel.append(chunk.toString()));
		let key = path.basename(config.dir) + '.test';
		runningProcess[key] = proc;
		proc.on('close', code => {
			delete(runningProcess, key);
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
 * Runs go main package and presents the output in the 'Go' channel.
 *
 * @param config the test execution configuration.
 */
function goRunMain(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		outputChannel.clear();
		outputChannel.show(2);
		let dir: string = vscode.workspace.getConfiguration('go')['runDir'];
		if (dir && dir.length) {
			// using configure directory and replace ${file_dir}
			let file_dir = path.dirname(file);
			dir = dir.replace('${file_dir}', file_dir);
			dir = path.normalize(dir);
		} else {
			// default using file directory
			dir = path.dirname(file);
		}
		let args = ['run', file];
		let runFlags: string[] = vscode.workspace.getConfiguration('go')['runArgs'];
		if (runFlags) {
			args = ['run', file, ...runFlags];
		}
		let proc = cp.spawn(getGoRuntimePath(), args, { env: process.env, cwd: dir });
		proc.stdout.on('data', chunk => outputChannel.append(chunk.toString()));
		proc.stderr.on('data', chunk => outputChannel.append(chunk.toString()));
		let key = path.basename(file, '.go');
		runningProcess[key] = proc;
		proc.on('close', code => {
			delete(runningProcess, key);
			if (code) {
				outputChannel.append('Error: Run failed.');
			} else {
				outputChannel.append('Success: Run passed.');
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
 * Check whether docment is main package or not.
 *
 * @param the URI of a Go source file.
 * @return whether document is main package or not.
 */
function isMainPackage(doc: vscode.TextDocument): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		let documentSymbolProvider = new GoDocumentSymbolProvider();
		documentSymbolProvider
			.provideDocumentSymbols(doc, null)
			.then(symbols => {
				let matched = false;
				symbols.forEach(sym => {
					if (sym.kind === vscode.SymbolKind.Function
						&& sym.name === 'main') {
							matched = true;
						}
				});
				resolve(matched);
				return;
			});
	});
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
