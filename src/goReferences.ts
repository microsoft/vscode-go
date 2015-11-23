/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath'

export class GoReferenceProvider implements vscode.ReferenceProvider {

	public provideReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return vscode.workspace.saveAll(false).then(() => {
			return this.doFindReferences(document, position, options, token);
		});
	}

	private doFindReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return new Promise((resolve, reject) => {
			var filename = this.canonicalizeForWindows(document.fileName);
			var cwd = path.dirname(filename)
			var workspaceRoot = vscode.workspace.rootPath;

			// get current word
			var wordRange = document.getWordRangeAtPosition(position);
			var textAtPosition = document.getText(wordRange)
			var wordLength = textAtPosition.length;
			var start = wordRange.start;
			var possibleDot = document.getText(new vscode.Range(start.line, start.character - 1, start.line, start.character))
			if (possibleDot == ".") {
				var previousWordRange = document.getWordRangeAtPosition(new vscode.Position(start.line, start.character - 1));
				var textAtPreviousPosition = document.getText(previousWordRange);
				wordLength += textAtPreviousPosition.length + 1;
			}

			var offset = document.offsetAt(position);

			var gofindreferences = getBinPath("go-find-references");

			cp.execFile(gofindreferences, ["-file", filename, "-offset", offset.toString(), "-root", workspaceRoot], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'go-find-references' command is not available.  Use 'go get -v github.com/lukehoban/go-find-references' to install.");
						return resolve(null);
					}

					var lines = stdout.toString().split('\n');
					var results: vscode.Location[] = [];
					for (var i = 0; i < lines.length; i += 2) {
						var line = lines[i];
						var match = /(.*):(\d+):(\d+)/.exec(lines[i]);
						if (!match) continue;
						var [_, file, lineStr, colStr] = match;
						var referenceResource = vscode.Uri.file(path.resolve(cwd, file));
						var range = new vscode.Range(
							+lineStr - 1, +colStr - 1, +lineStr - 1, +colStr + wordLength - 1
						);
						results.push(new vscode.Location(referenceResource, range));
					}
					resolve(results);
				} catch (e) {
					reject(e);
				}
			});
		});
	}

	private canonicalizeForWindows(filename: string): string {
		// convert backslashes to forward slashes on Windows
		// otherwise go-find-references returns no matches
		if (/^[a-z]:\\/.test(filename))
			return filename.replace(/\\/g, '/');
		return filename;
	}

}
