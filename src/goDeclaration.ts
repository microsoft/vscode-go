/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

class DeclartionSupport implements vscode.Modes.IDeclarationSupport {

	public findDeclaration(document:vscode.Document, position:vscode.Position, token: vscode.CancellationToken):Thenable<vscode.Modes.IReference> {

		return new Promise((resolve, reject) => {

			var wordAtPosition = document.getWordRangeAtPosition(position);

			// compute the file offset for position
			var range = new vscode.Range(0, 0, position.line, position.column);
			var offset = document.getTextInRange(range).length;

			var godef = path.join(process.env["GOPATH"], "bin", "godef");

			// Spawn `godef` process
			var p = cp.execFile(godef, ["-t", "-i", "-f", document.getUri().fsPath, "-o", offset.toString()], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'godef' command is not available.  Use 'go get -u github.com/rogpeppe/godef' to install.");
					}
					if (err) return resolve(null);
					var result = stdout.toString();
					var lines = result.split('\n');
					// TODO: Goto def on a package name import will return juts a plain
					// path to a folder here - can we go to a folder?
					var match = /(.*):(\d+):(\d+)/.exec(lines[0]);
					if(!match) return resolve(null);
					var [_, file, line, col] = match;
					var definitionResource = vscode.Uri.file(file);
					var range = new vscode.Range(+line, +col, +line, +col + 1);
					return resolve({
						resource: definitionResource,
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

export = DeclartionSupport;