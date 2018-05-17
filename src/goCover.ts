/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import os = require('os');
import fs = require('fs');
import { showTestOutput, goTest } from './testUtils';
import rl = require('readline');

export let coveredGutter;
export let uncoveredGutter;

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

export function initGoCover(ctx: vscode.ExtensionContext) {
	coveredGutter = vscode.window.createTextEditorDecorationType({
		// Gutter green
		gutterIconPath: ctx.asAbsolutePath('images/gutter-green.svg')
	});
	uncoveredGutter = vscode.window.createTextEditorDecorationType({
		// Gutter red
		gutterIconPath: ctx.asAbsolutePath('images/gutter-red.svg')
	});
}

export function removeCodeCoverage(e: vscode.TextDocumentChangeEvent) {
	let editor = vscode.window.visibleTextEditors.find((value, index, obj) => {
		return value.document === e.document;
	});
	if (!editor) {
		return;
	}
	for (let filename in coverageFiles) {
		let found = editor.document.uri.fsPath.endsWith(filename);
		// Check for file again if outside the $GOPATH.
		if (!found && filename.startsWith('_')) {
			found = editor.document.uri.fsPath.endsWith(filename.slice(1));
		}
		if (found) {
			highlightCoverage(editor, coverageFiles[filename], true);
			delete coverageFiles[filename];
		}
	}
}

export function toggleCoverageCurrentPackage() {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}

	// If current file has highlights, then remove coverage, else add coverage
	for (let filename in coverageFiles) {
		let found = editor.document.uri.fsPath.endsWith(filename);
		// Check for file again if outside the $GOPATH.
		if (!found && filename.startsWith('_')) {
			found = editor.document.uri.fsPath.endsWith(filename.slice(1));
		}
		if (found) {
			clearCoverage();
			return;
		}
	}

	let goConfig = vscode.workspace.getConfiguration('go', editor.document.uri);
	let cwd = path.dirname(editor.document.uri.fsPath);

	let buildFlags = goConfig['testFlags'] || goConfig['buildFlags'] || [];
	let tmpCoverPath = path.normalize(path.join(os.tmpdir(), 'go-code-cover'));
	let args = ['-coverprofile=' + tmpCoverPath, ...buildFlags];
	return goTest({
		goConfig: goConfig,
		dir: cwd,
		flags: args,
		background: true
	}).then(success => {
		if (!success) {
			showTestOutput();
			return [];
		}
		return getCoverage(tmpCoverPath, true);
	});
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
		vscode.window.visibleTextEditors.forEach((value, index, obj) => {
			let found = value.document.fileName.endsWith(filename);
			// Check for file again if outside the $GOPATH.
			if (!found && filename.startsWith('_')) {
				found = value.document.fileName.endsWith(filename.slice(1));
			}
			if (found) {
				highlightCoverage(value, file, remove);
			}
			return found;
		});
	});
}

function highlightCoverage(editor: vscode.TextEditor, file: CoverageFile, remove: boolean) {
	let cfg = vscode.workspace.getConfiguration('go', editor.document.uri);
	let coverageOptions = cfg['coverageOptions'];
	let coverageDecorator = cfg['coverageDecorator'];

	editor.setDecorations(coveredGutter, []);
	editor.setDecorations(coveredHighLight, []);
	editor.setDecorations(uncoveredGutter, []);
	editor.setDecorations(uncoveredHighLight, []);

	if (remove) {
		return;
	}

	if (coverageOptions === 'showCoveredCodeOnly' || coverageOptions === 'showBothCoveredAndUncoveredCode') {
		editor.setDecorations(coverageDecorator === 'gutter' ? coveredGutter : coveredHighLight, file.coveredRange);
	}

	if (coverageOptions === 'showUncoveredCodeOnly' || coverageOptions === 'showBothCoveredAndUncoveredCode') {
		editor.setDecorations(coverageDecorator === 'gutter' ? uncoveredGutter : uncoveredHighLight, file.uncoveredRange);
	}
}

export function getCoverage(coverProfilePath: string, showErrOutput: boolean = false): Promise<any[]> {
	return new Promise((resolve, reject) => {
		try {
			// Clear existing coverage files
			clearCoverage();

			let lines = rl.createInterface({
				input: fs.createReadStream(coverProfilePath),
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
}
