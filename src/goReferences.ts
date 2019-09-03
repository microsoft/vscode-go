/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath, byteOffsetAt, canonicalizeGOPATHPrefix, getFileArchive, getToolsEnvVars, killTree, getTimeoutConfiguration } from './util';
import { promptForMissingTool } from './goInstallTools';

export class GoReferenceProvider implements vscode.ReferenceProvider {

	public provideReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return this.doFindReferences(document, position, options, token);
	}

	private doFindReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return new Promise<vscode.Location[]>((resolve, reject) => {
			// get current word
			const wordRange = document.getWordRangeAtPosition(position);
			if (!wordRange) {
				return resolve([]);
			}

			const goGuru = getBinPath('guru');
			if (!path.isAbsolute(goGuru)) {
				promptForMissingTool('guru');
				return reject('Cannot find tool "guru" to find references.');
			}

			const filename = canonicalizeGOPATHPrefix(document.fileName);
			const cwd = path.dirname(filename);
			const offset = byteOffsetAt(document, wordRange.start);
			const env = getToolsEnvVars();
			const buildTags = vscode.workspace.getConfiguration('go', document.uri)['buildTags'];
			const args = buildTags ? ['-tags', buildTags] : [];
			args.push('-modified', 'referrers', `${filename}:#${offset.toString()}`);

			let p: cp.ChildProcess;
			let processTimeout: NodeJS.Timeout;
			p = cp.execFile(goGuru, args, { env }, (err, stdout, stderr) => {
				clearTimeout(processTimeout);
				try {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool('guru');
						return reject('Cannot find tool "guru" to find references.');
					}

					if (err && (<any>err).killed !== true) {
						return reject(`Error running guru: ${err.message || stderr}`);
					}

					const lines = stdout.toString().split('\n');
					const results: vscode.Location[] = [];
					for (let i = 0; i < lines.length; i++) {
						const match = /^(.*):(\d+)\.(\d+)-(\d+)\.(\d+):/.exec(lines[i]);
						if (!match) continue;
						const [_, file, lineStartStr, colStartStr, lineEndStr, colEndStr] = match;
						const referenceResource = vscode.Uri.file(path.resolve(cwd, file));

						if (!options.includeDeclaration) {
							if (document.uri.fsPath === referenceResource.fsPath &&
								position.line === Number(lineStartStr) - 1) {
								continue;
							}
						}

						const range = new vscode.Range(
							+lineStartStr - 1, +colStartStr - 1, +lineEndStr - 1, +colEndStr
						);
						results.push(new vscode.Location(referenceResource, range));
					}
					resolve(results);
				} catch (e) {
					reject(e);
				}
			});
			if (p.pid) {
				p.stdin.end(getFileArchive(document));
			}
			processTimeout = setTimeout(() => {
				killTree(p.pid);
				reject('Timeout executing tool - guru');
			}, getTimeoutConfiguration('onCommand'));
			token.onCancellationRequested(() => {
				clearTimeout(processTimeout);
				killTree(p.pid);
			});
		});
	}

}
