/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

export class GoReferenceProvider implements vscode.ReferenceProvider {

	public provideReferences(document: vscode.TextDocument, position:vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return vscode.workspace.saveAll(false).then(() => {
				return this.doFindReferences(document, position, options, token);
		});
	}

	private doFindReferences(document:vscode.TextDocument, position:vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return new Promise((resolve, reject) => {
			var filename = this.canonicalizeForWindows(document.uri.fsPath);
			var cwd = path.dirname(filename)
			var workspaceRoot = vscode.workspace.rootPath;

			// get current word
			var wordAtPosition = document.getWordRangeAtPosition(position);
			var offset = document.offsetAt(position);

			var gofindreferences = path.join(process.env["GOPATH"], "bin", "go-find-references");

			cp.execFile(gofindreferences, ["-file", filename, "-offset", offset.toString(), "-root", workspaceRoot], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'go-find-references' command is not available.  Use 'go get -v github.com/lukehoban/go-find-references' to install.");
						return resolve(null);
					}

					var lines = stdout.toString().split('\n');
					var results: vscode.Location[] = [];
					for(var i = 0; i < lines.length; i+=2) {
						var line = lines[i];
						var match = /(.*):(\d+):(\d+)/.exec(lines[i]);
						if(!match) continue;
						var [_, file, lineStr, colStr] = match;
						var referenceResource = vscode.Uri.file(path.resolve(cwd, file));
						var range = new vscode.Range(
							+lineStr-1, +colStr-1, +lineStr-1, +colStr + wordAtPosition.end.character - wordAtPosition.start.character-1
						);
						results.push(
							new vscode.Location(referenceResource, range));
					}
					resolve(results);
				} catch(e) {
					reject(e);
				}
			});
		});
	}

	private canonicalizeForWindows(filename:string):string {
		// convert backslashes to forward slashes on Windows
		// otherwise go-find-references returns no matches
		if (/^[a-z]:\\/.test(filename))
			return filename.replace(/\\/g, '/');
		return filename;
	}

}
