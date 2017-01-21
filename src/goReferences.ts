/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath, byteOffsetAt, canonicalizeGOPATHPrefix } from './util';
import { promptForMissingTool } from './goInstallTools';

export class GoReferenceProvider implements vscode.ReferenceProvider {

	public provideReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return vscode.workspace.saveAll(false).then(() => {
			return this.doFindReferences(document, position, options, token);
		});
	}

	private doFindReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return new Promise((resolve, reject) => {
			let filename = canonicalizeGOPATHPrefix(document.fileName);
			let cwd = path.dirname(filename);

			// get current word
			let wordRange = document.getWordRangeAtPosition(position);
			if (!wordRange) {
				return resolve([]);
			}

			let offset = byteOffsetAt(document, position);

			let goGuru = getBinPath('guru');
			let buildTags = '"' + vscode.workspace.getConfiguration('go')['buildTags'] + '"';

			let process = cp.execFile(goGuru, ['-tags', buildTags, 'referrers', `${filename}:#${offset.toString()}`], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool('guru');
						return resolve(null);
					}
					if (err) {
						console.log(err);
						return resolve(null);
					}
					let lines = stdout.toString().split('\n');
					let results: vscode.Location[] = [];
					for (let i = 0; i < lines.length; i++) {
						let line = lines[i];
						let match = /^(.*):(\d+)\.(\d+)-(\d+)\.(\d+):/.exec(lines[i]);
						if (!match) continue;
						let [_, file, lineStartStr, colStartStr, lineEndStr, colEndStr] = match;
						let referenceResource = vscode.Uri.file(path.resolve(cwd, file));
						let range = new vscode.Range(
							+lineStartStr - 1, +colStartStr - 1, +lineEndStr - 1, +colEndStr
						);
						results.push(new vscode.Location(referenceResource, range));
					}
					resolve(results);
				} catch (e) {
					reject(e);
				}
			});

			token.onCancellationRequested(() =>
				process.kill()
			);
		});
	}

}
