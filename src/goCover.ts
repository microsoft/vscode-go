/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import os = require('os');
import fs = require('fs');
import { getBinPath, getGoRuntimePath } from './goPath';
import rl = require('readline');

if (!getGoRuntimePath()) {
	vscode.window.showInformationMessage("No 'go' binary could be found on PATH or in GOROOT.");
}

export function coverageCurrentFile() {
	var editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage("No editor is active.");
		return;
	}
	getCoverage(editor.document.uri.fsPath);
}

export function getCoverage(filename: string): Promise<any[]> {
	return  new Promise((resolve, reject) => {
		var tmppath = path.normalize(path.join(os.tmpdir(), "go-code-cover"))
		var cwd = path.dirname(filename)
		var args = ["test", "-coverprofile=" + tmppath];		
		cp.execFile(getGoRuntimePath(), args, { cwd: cwd }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code == "ENOENT") {
					vscode.window.showInformationMessage("Could not generate coverage report.  Install Go from http://golang.org/dl/.");
					return resolve([]);
				}
				var ret = [];
				
				var lines = rl.createInterface({
					input: fs.createReadStream(tmppath),
					output: undefined
				});
				
				var coveredRange = [], 
					uncoveredRange =[],
					uncoveredHighLight = vscode.window.createTextEditorDecorationType({
					// Red
					backgroundColor: 'rgba(128,64,64,0.5)',
					isWholeLine: false
				}), coveredHighLight = vscode.window.createTextEditorDecorationType({
					// Green
					backgroundColor: 'rgba(64,128,64,0.5)',
					isWholeLine: false
				});

				lines.on('line', function(data: string) {
					// go test coverageprofile generates output: 
					//    filename:StartLine.StartColumn,EndLine.EndColumn Hits IsCovered
					var fileRange = data.match(/([^:]+)\:([\d]+)\.([\d]+)\,([\d]+)\.([\d]+)\s([\d]+)\s([\d]+)/);
					if (fileRange) {
						// If line matches active file
						if (filename.endsWith(fileRange[1])) {
							var range = { 
								range: new vscode.Range(
									// Start Line converted to zero based
									parseInt(fileRange[2]) - 1,
									// Start Column converted to zero based
									parseInt(fileRange[3]) - 1, 
									// End Line converted to zero based
									parseInt(fileRange[4]) - 1,
									// End Column converted to zero based
									parseInt(fileRange[5]) - 1
								) 
							};
							// If is Covered
							if (parseInt(fileRange[7]) === 1) {
								coveredRange.push(range);	
							} 
							// Not Covered
							else {
								uncoveredRange.push(range);	
							}
						}							
					}					
				});
				lines.on('close', function(data) {
					// Highlight lines in current editor.
					vscode.window.activeTextEditor.setDecorations(uncoveredHighLight, uncoveredRange);
					vscode.window.activeTextEditor.setDecorations(coveredHighLight, coveredRange);
					resolve(ret);
				});
			} catch (e) {
				vscode.window.showInformationMessage(e.msg);
				reject(e);
			}
		});
	});
}