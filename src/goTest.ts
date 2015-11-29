'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import util = require('util');
import { getGoRuntimePath } from './goPath'

/**
* Executes the unit test at the primary cursor using `go test`. Output
* is sent to the 'Go' channel.
* 
* @param timeout an optional ParseDuration formatted timeout string for the tests.
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
	// TODO: This command should be returning a SymbolInformation[] but is instead
	// returning an object with slightly different fields which must be adapted.
	vscode.commands.executeCommand<any[]>('vscode.executeDocumentSymbolProvider', editor.document.uri).then(res => {
		var testFunction: string;
		// Find any test function containing the cursor.
		for (let obj of res) {
			var sym = newSymbolInformation(obj);
			// Skip anything that's not a test function.
			if (sym.kind != vscode.SymbolKind.Function) continue;
			if (!/Test.*/.exec(sym.name)) continue;
			// Determine if the function contains the primary cursor.
			var selection = editor.selection;
			if (selection && sym.location.range.contains(selection.start)) {
				testFunction = sym.name;
				break;
			}
		};
		if (!testFunction) {
			vscode.window.setStatusBarMessage('No test function found at cursor.', 5000);
			return;
		}
		// Run the test and present the output in a channel.
		var channel = vscode.window.createOutputChannel('Go');
		channel.clear();
		channel.show(2);
		var args = ['test', '-v', '-timeout', timeout, '-run', util.format('^%s$', testFunction)];
		var proc = cp.spawn(getGoRuntimePath(), args, { env: process.env, cwd: path.dirname(editor.document.fileName) });
		proc.stdout.on('data', chunk => channel.append(chunk.toString()));
		proc.stderr.on('data', chunk => channel.append(chunk.toString()));
		proc.on('close', code => {
			if (code) {
				channel.append("Error: Tests failed.");
			} else {
				channel.append("Success: Tests passed.");
			}
		});
	}, err => {
		console.error(err);
	})
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
