/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import util = require('util');
import { getGoRuntimePath } from './goPath'
import { GoDocumentSymbolProvider } from './goOutline'

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
	var editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage("No editor is active.");
		return;
	}
	getTestFunctions(editor.document).then(testFunctions => {
		var testFunction: vscode.SymbolInformation;
		// Find any test function containing the cursor.
		for (let func of testFunctions) {
			var selection = editor.selection;
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
	})
}

/**
 * Runs all tests in the package of the source of the active editor.
 *
 * @param timeout a ParseDuration formatted timeout string for the tests.
 */
export function testCurrentPackage(timeout: string) {
	var editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage("No editor is active.");
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
	var editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage("No editor is active.");
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
 * Runs go test and presents the output in the 'Go' channel.
 *
 * @param config the test execution configuration.
 */
function goTest(config: TestConfig): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		var channel = vscode.window.createOutputChannel('Go');
		channel.clear();
		channel.show(2);
		var args = ['test', '-v', '-timeout', config.timeout];
		if (config.functions) {
			args.push('-run');
			args.push(util.format('^%s$', config.functions.join('|')));
		}
		var proc = cp.spawn(getGoRuntimePath(), args, { env: process.env, cwd: config.dir });
		proc.stdout.on('data', chunk => channel.append(chunk.toString()));
		proc.stderr.on('data', chunk => channel.append(chunk.toString()));
		proc.on('close', code => {
			if (code) {
				channel.append("Error: Tests failed.");
			} else {
				channel.append("Success: Tests passed.");
			}
			resolve(code == 0);
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
				sym.kind == vscode.SymbolKind.Function 
				&& /Test.*/.exec(sym.name) != null)
		);
}
