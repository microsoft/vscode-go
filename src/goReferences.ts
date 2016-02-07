/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath';
import { byteOffsetAt } from './util';

export class GoReferenceProvider implements vscode.ReferenceProvider {

	public provideReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return vscode.workspace.saveAll(false).then(() => {
			return this.doFindReferences(document, position, options, token);
		});
	}

	private doFindReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return new Promise((resolve, reject) => {
			let filename = this.canonicalizeForWindows(document.fileName);
			let cwd = path.dirname(filename);
			let workspaceRoot = vscode.workspace.rootPath;

			// get current word
			let wordRange = document.getWordRangeAtPosition(position);
			if (!wordRange) {
				return resolve([]);
			}
			let textAtPosition = document.getText(wordRange);
			let wordLength = textAtPosition.length;
			let start = wordRange.start;
			let possibleDot = '';
			if (start.character > 0) {
				possibleDot = document.getText(new vscode.Range(start.line, start.character - 1, start.line, start.character));
			}
			if (possibleDot === '.') {
				let previousWordRange = document.getWordRangeAtPosition(new vscode.Position(start.line, start.character - 1));
				let textAtPreviousPosition = document.getText(previousWordRange);
				wordLength += textAtPreviousPosition.length + 1;
			}

			let offset = byteOffsetAt(document, position);

			let gofindreferences = getBinPath('go-find-references');

			cp.execFile(gofindreferences, ['-file', filename, '-offset', offset.toString(), '-root', workspaceRoot], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						vscode.window.showInformationMessage('The "go-find-references" command is not available.  Use "go get -v github.com/lukehoban/go-find-references" to install.');
						return resolve(null);
					}

					let lines = stdout.toString().split('\n');
					let results: vscode.Location[] = [];
					for (let i = 0; i < lines.length; i += 2) {
						let line = lines[i];
						let match = /(.*):(\d+):(\d+)/.exec(lines[i]);
						if (!match) continue;
						let [_, file, lineStr, colStr] = match;
						let referenceResource = vscode.Uri.file(path.resolve(cwd, file));
						let range = new vscode.Range(
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
