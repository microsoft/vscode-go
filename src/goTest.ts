'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import util = require('util');
import { getGoRuntimePath } from './goPath'

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
	getTestFunctions(editor.document.uri).then(testFunctions => {
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
		goTest({
			timeout: timeout,
			dir: path.dirname(editor.document.fileName),
			functions: [testFunction.name]
		});
	}, err => {
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
	getTestFunctions(editor.document.uri).then(testFunctions => {
		goTest({
			timeout: timeout,
			dir: path.dirname(editor.document.fileName),
			functions: testFunctions.map(func => { return func.name; })
		});
	}, err => {
		console.error(err);
	})
}

/**
 * Runs go test and presents the output in the 'Go' channel.
 *
 * @param config the test execution configuration.
 */
function goTest(config: TestConfig) {
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
	});
}

/**
 * Returns all Go unit test functions in the given source file.
 *
 * @param the URI of a Go source file.
 * @return test function symbols for the source file.
 */
function getTestFunctions(uri: vscode.Uri): Promise<vscode.SymbolInformation[]> {
	return new Promise((resolve, reject) => {
		vscode.commands.executeCommand<any[]>('vscode.executeDocumentSymbolProvider', uri).then(res => {
			var testFunctions: vscode.SymbolInformation[] = [];
			for (let obj of res) {
				var sym = newSymbolInformation(obj);
				if (sym.kind == vscode.SymbolKind.Function && /Test.*/.exec(sym.name)) {
					testFunctions.push(sym);
				}
			}
			resolve(testFunctions);
		}, err => {
			reject(err);
		});
	});
}

/**
* Converts the output of the vscode.executeDocumentSymbolProvider command to
* a vscode.SymbolInformation.
*
* Warning: This implementation is far from complete.
*
* TODO: This shouldn't be necessary; see https://github.com/Microsoft/vscode/issues/769
*
* @param obj an object returned from executeDocumentSymbolProvider.
* @return the converted SymbolInformation.
*/
function newSymbolInformation(obj: any): vscode.SymbolInformation {
	var kind: vscode.SymbolKind
	switch (obj.type) {
		case 'function':
			kind = vscode.SymbolKind.Function;
	}
	var startPosition = new vscode.Position(obj.range.startLineNumber, obj.range.startColumn);
	var endPosition = new vscode.Position(obj.range.endLineNumber, obj.range.endColumn);
	var range = new vscode.Range(startPosition, endPosition);
	return new vscode.SymbolInformation(obj.label, kind, range, null, obj.containerName);
}
