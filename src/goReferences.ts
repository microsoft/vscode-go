/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath, byteOffsetAt, canonicalizeGOPATHPrefix, getFileArchive, getToolsEnvVars } from './util';
import { promptForMissingTool } from './goInstallTools';

export class GoReferenceProvider implements vscode.ReferenceProvider {

	public provideReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return this.doFindReferences(document, position, options, token);
	}

	private doFindReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return new Promise<vscode.Location[]>((resolve, reject) => {
			// get current word
			let wordRange = document.getWordRangeAtPosition(position);
			if (!wordRange) {
				return resolve([]);
			}

			let goGuru = getBinPath('guru');
			if (!path.isAbsolute(goGuru)) {
				promptForMissingTool('guru');
				return reject('Cannot find tool "guru" to find references.');
			}

			let filename = canonicalizeGOPATHPrefix(document.fileName);
			let cwd = path.dirname(filename);
			let offset = byteOffsetAt(document, position);
			let env = getToolsEnvVars();
			let buildTags = vscode.workspace.getConfiguration('go', document.uri)['buildTags'];
			let args = buildTags ? ['-tags', buildTags] : [];
			args.push('-modified', 'referrers', `${filename}:#${offset.toString()}`);

			let process = cp.execFile(goGuru, args, { env }, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool('guru');
						return reject('Cannot find tool "guru" to find references.');
					}

					if (err && (<any>err).killed !== true) {
						return reject(`Error running guru: ${err.message || stderr}`);
					}

					let lines = stdout.toString().split('\n');
					let results: vscode.Location[] = [];
					for (let i = 0; i < lines.length; i++) {
						let match = /^(.*):(\d+)\.(\d+)-(\d+)\.(\d+):/.exec(lines[i]);
						if (!match) continue;
						let [_, file, lineStartStr, colStartStr, lineEndStr, colEndStr] = match;
						let referenceResource = vscode.Uri.file(path.resolve(cwd, file));

						if (!options.includeDeclaration) {
							if (document.uri.fsPath === referenceResource.fsPath &&
								position.line === Number(lineStartStr) - 1) {
								continue;
							}
						}

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
			process.stdin.end(getFileArchive(document));

			token.onCancellationRequested(() =>
				process.kill()
			);
		});
	}

}
