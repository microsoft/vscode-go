/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

class ExtraInfoSupport implements vscode.Modes.IExtraInfoSupport {


	public computeInfo(document:vscode.Document, position:vscode.Position, token: vscode.CancellationToken): Promise<vscode.Modes.IComputeExtraInfoResult> {

		return new Promise((resolve, reject) => {
			var filename = document.getUri().fsPath;
			var wordAtPosition = document.getWordRangeAtPosition(position);

			// compute the file offset for position
			var range = new vscode.Range(0, 0, position.line, position.column);
			var offset = document.getTextInRange(range).length;

			var godef = path.join(process.env["GOPATH"], "bin", "godef");

			// Spawn `godef` process
			var p = cp.execFile(godef, ["-t", "-i", "-f", filename, "-o", offset.toString()], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'godef' command is not available.  Use 'go get -u github.com/rogpeppe/godef' to install.");
					}
					if (err) return resolve(null);
					var result = stdout.toString();
					var lines = result.split('\n');
					if(lines.length > 10) lines[9] = "...";
					var text = lines.slice(1,10).join('\n');
					var range = new vscode.Range(
						position.line,
						wordAtPosition ? wordAtPosition.start.column : position.column,
						position.line,
						wordAtPosition ? wordAtPosition.end.column : position.column);
					return resolve({
						htmlContent: [
							{ formattedText: text }
						],
						range
					});
				} catch(e) {
					reject(e);
				}
			});
			p.stdin.end(document.getText());
		});
	}
}

export = ExtraInfoSupport;