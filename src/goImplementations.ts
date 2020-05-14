/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import { promptForMissingTool } from './goInstallTools';
import { envPath } from './goPath';
import {
	byteOffsetAt,
	canonicalizeGOPATHPrefix,
	getBinPath,
	getGoConfig,
	getToolsEnvVars,
	getWorkspaceFolderPath,
	killTree
} from './util';

interface GoListOutput {
	Dir: string;
	ImportPath: string;
	Root: string;
}

interface GuruImplementsRef {
	name: string;
	pos: string;
	kind: string;
}

interface GuruImplementsOutput {
	type: GuruImplementsRef;
	to: GuruImplementsRef[];
	to_method: GuruImplementsRef[];
	from: GuruImplementsRef[];
	fromptr: GuruImplementsRef[];
}

export class GoImplementationProvider implements vscode.ImplementationProvider {
	public provideImplementation(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Thenable<vscode.Definition> {
		// To keep `guru implements` fast we want to restrict the scope of the search to current workspace
		// If no workspace is open, then no-op
		const root = getWorkspaceFolderPath(document.uri);
		if (!root) {
			vscode.window.showInformationMessage('Cannot find implementations when there is no workspace open.');
			return;
		}

		const goRuntimePath = getBinPath('go');
		if (!goRuntimePath) {
			vscode.window.showErrorMessage(
				`Failed to run "go list" to get the scope to find implementations as the "go" binary cannot be found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`
			);
			return;
		}

		return new Promise<vscode.Definition>((resolve, reject) => {
			if (token.isCancellationRequested) {
				return resolve(null);
			}
			const env = getToolsEnvVars();
			const listProcess = cp.execFile(
				goRuntimePath,
				['list', '-e', '-json'],
				{ cwd: root, env },
				(err, stdout, stderr) => {
					if (err) {
						return reject(err);
					}
					const listOutput = <GoListOutput>JSON.parse(stdout.toString());
					const filename = canonicalizeGOPATHPrefix(document.fileName);
					const cwd = path.dirname(filename);
					const offset = byteOffsetAt(document, position);
					const goGuru = getBinPath('guru');
					const buildTags = getGoConfig(document.uri)['buildTags'];
					const args = buildTags ? ['-tags', buildTags] : [];
					if (listOutput.Root && listOutput.ImportPath) {
						args.push('-scope', `${listOutput.ImportPath}/...`);
					}
					args.push('-json', 'implements', `${filename}:#${offset.toString()}`);

					const guruProcess = cp.execFile(goGuru, args, { env }, (guruErr, guruStdOut, guruStdErr) => {
						if (guruErr && (<any>guruErr).code === 'ENOENT') {
							promptForMissingTool('guru');
							return resolve(null);
						}

						if (guruErr) {
							return reject(guruErr);
						}

						const guruOutput = <GuruImplementsOutput>JSON.parse(guruStdOut.toString());
						const results: vscode.Location[] = [];
						const addResults = (list: GuruImplementsRef[]) => {
							list.forEach((ref: GuruImplementsRef) => {
								const match = /^(.*):(\d+):(\d+)/.exec(ref.pos);
								if (!match) {
									return;
								}
								const [_, file, lineStartStr, colStartStr] = match;
								const referenceResource = vscode.Uri.file(path.resolve(cwd, file));
								const range = new vscode.Range(
									+lineStartStr - 1,
									+colStartStr - 1,
									+lineStartStr - 1,
									+colStartStr
								);
								results.push(new vscode.Location(referenceResource, range));
							});
						};

						// If we looked for implementation of method go to method implementations only
						if (guruOutput.to_method) {
							addResults(guruOutput.to_method);
						} else if (guruOutput.to) {
							addResults(guruOutput.to);
						} else if (guruOutput.from) {
							addResults(guruOutput.from);
						} else if (guruOutput.fromptr) {
							addResults(guruOutput.fromptr);
						}

						return resolve(results);
					});
					token.onCancellationRequested(() => killTree(guruProcess.pid));
				}
			);
			token.onCancellationRequested(() => killTree(listProcess.pid));
		});
	}
}
