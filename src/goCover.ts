/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import os = require('os');
import fs = require('fs');
import { getGoRuntimePath } from './goPath';
import { getBinPath } from './util';
import rl = require('readline');
import { outputChannel } from './goStatus';

let coveredHighLight = vscode.window.createTextEditorDecorationType({
	// Green
	backgroundColor: 'rgba(64,128,64,0.5)',
	isWholeLine: false
});
let uncoveredHighLight = vscode.window.createTextEditorDecorationType({
	// Red
	backgroundColor: 'rgba(128,64,64,0.5)',
	isWholeLine: false
});
let coverageFiles = {};

interface CoverageFile {
	filename: string;
	uncoveredRange: vscode.Range[];
	coveredRange: vscode.Range[];
}

function clearCoverage() {
	applyCoverage(true);
	coverageFiles = {};
}

export function removeCodeCoverage(e: vscode.TextDocumentChangeEvent) {
	let editor = vscode.window.visibleTextEditors.find((value, index, obj) => {
		return value.document === e.document;
	});
	if (!editor) {
		return;
	}
	for (let filename in coverageFiles) {
		if (editor.document.uri.fsPath.endsWith(filename)) {
			highlightCoverage(editor, coverageFiles[filename], true);
			delete coverageFiles[filename];
		}
	}
}

export function coverageCurrentPackage() {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	getCoverage(editor.document.uri.fsPath, true);
}

export function getCodeCoverage(editor: vscode.TextEditor) {
	if (!editor) {
		return;
	}
	for (let filename in coverageFiles) {
		if (editor.document.uri.fsPath.endsWith(filename)) {
			highlightCoverage(editor, coverageFiles[filename], false);
		}
	}
}

function applyCoverage(remove: boolean = false) {
	Object.keys(coverageFiles).forEach(filename => {
		let file = coverageFiles[filename];
		// Highlight lines in current editor.
		let editor = vscode.window.visibleTextEditors.find((value, index, obj) => {
			return value.document.fileName.endsWith(filename);
		});
		if (editor) {
			highlightCoverage(editor, file, remove);
		}
	});
}

function highlightCoverage(editor: vscode.TextEditor, file: CoverageFile, remove: boolean) {
	editor.setDecorations(uncoveredHighLight, remove ? [] : file.uncoveredRange);
	editor.setDecorations(coveredHighLight, remove ? [] : file.coveredRange);
}

export function getCoverage(filename: string, showErrOutput: boolean = false): Promise<any[]> {
	return new Promise((resolve, reject) => {
		let tmppath = path.normalize(path.join(os.tmpdir(), 'go-code-cover'));
		let cwd = path.dirname(filename);
		let args = ['test', '-coverprofile=' + tmppath];
		let goRuntimePath = getGoRuntimePath();

		if (!goRuntimePath) {
			vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
			return Promise.resolve([]);
		}

		// make sure tmppath exists
		fs.closeSync(fs.openSync(tmppath, 'a'));

		cp.execFile(goRuntimePath, args, { cwd: cwd }, (err, stdout, stderr) => {
			try {
				// Clear existing coverage files
				clearCoverage();
				if (err && (<any>err).code !== 0) {
					outputChannel.appendLine(['Finished running tool:', goRuntimePath, ...args].join(' '));
					outputChannel.appendLine(((<any>err).message));
					if (showErrOutput) {
						outputChannel.show(true);
					}
					return resolve([]);
				}

				let lines = rl.createInterface({
					input: fs.createReadStream(tmppath),
					output: undefined
				});

				lines.on('line', function (data: string) {
					// go test coverageprofile generates output:
					//    filename:StartLine.StartColumn,EndLine.EndColumn Hits IsCovered
					// The first line will be "mode: set" which will be ignored
					let fileRange = data.match(/([^:]+)\:([\d]+)\.([\d]+)\,([\d]+)\.([\d]+)\s([\d]+)\s([\d]+)/);
					if (!fileRange) return;

					let coverage = coverageFiles[fileRange[1]] || { coveredRange: [], uncoveredRange: [] };
					let range = new vscode.Range(
						// Start Line converted to zero based
						parseInt(fileRange[2]) - 1,
						// Start Column converted to zero based
						parseInt(fileRange[3]) - 1,
						// End Line converted to zero based
						parseInt(fileRange[4]) - 1,
						// End Column converted to zero based
						parseInt(fileRange[5]) - 1
					);
					// If is Covered
					if (parseInt(fileRange[7]) === 1) {
						coverage.coveredRange.push({ range });
					}
					// Not Covered
					else {
						coverage.uncoveredRange.push({ range });
					}
					coverageFiles[fileRange[1]] = coverage;
				});
				lines.on('close', function (data) {
					applyCoverage();
					resolve([]);
				});
			} catch (e) {
				vscode.window.showInformationMessage(e.msg);
				reject(e);
			}
		});
	});
}
