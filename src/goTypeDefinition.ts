/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { byteOffsetAt, getBinPath, canonicalizeGOPATHPrefix, getFileArchive, killTree, goBuiltinTypes, isPositionInString, goKeywords } from './util';
import { promptForMissingTool } from './goInstallTools';
import { getToolsEnvVars } from './util';
import { definitionLocation, parseMissingError, adjustWordPosition } from './goDeclaration';

interface GuruDescribeOutput {
	desc: string;
	pos: string;
	detail: string;
	value: GuruDescribeValueOutput;
}

interface GuruDescribeValueOutput {
	type: string;
	value: string;
	objpos: string;
	typespos: GuruDefinitionOutput[];
}

interface GuruDefinitionOutput {
	objpos: string;
	desc: string;
}

export class GoTypeDefinitionProvider implements vscode.TypeDefinitionProvider {
	provideTypeDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition> {
		let adjustedPos = adjustWordPosition(document, position);
		if (!adjustedPos[0]) {
			return Promise.resolve(null);
		}
		position = adjustedPos[2];

		return new Promise<vscode.Definition>((resolve, reject) => {
			let goGuru = getBinPath('guru');
			if (!path.isAbsolute(goGuru)) {
				promptForMissingTool('guru');
				return reject('Cannot find tool "guru" to find type definitions.');
			}

			let filename = canonicalizeGOPATHPrefix(document.fileName);
			let offset = byteOffsetAt(document, position);
			let env = getToolsEnvVars();
			let buildTags = vscode.workspace.getConfiguration('go', document.uri)['buildTags'];
			let args = buildTags ? ['-tags', buildTags] : [];
			args.push('-json', '-modified', 'describe', `${filename}:#${offset.toString()}`);

			let process = cp.execFile(goGuru, args, { env }, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool('guru');
						return resolve(null);
					}

					if (err) {
						return reject(err);
					}

					let guruOutput = <GuruDescribeOutput>JSON.parse(stdout.toString());
					if (!guruOutput.value || !guruOutput.value.typespos) {
						if (guruOutput.value
							&& guruOutput.value.type
							&& !goBuiltinTypes.has(guruOutput.value.type)
							&& guruOutput.value.type !== 'invalid type') {
							console.log('no typespos from guru\'s output - try to update guru tool');
						}

						// Fall back to position of declaration
						return definitionLocation(document, position, null, false, token).then(definitionInfo => {
							if (definitionInfo == null || definitionInfo.file == null) return null;
							let definitionResource = vscode.Uri.file(definitionInfo.file);
							let pos = new vscode.Position(definitionInfo.line, definitionInfo.column);
							resolve(new vscode.Location(definitionResource, pos));
						}, err => {
							let miss = parseMissingError(err);
							if (miss[0]) {
								promptForMissingTool(miss[1]);
							} else if (err) {
								return Promise.reject(err);
							}
							return Promise.resolve(null);
						});
					}

					let results: vscode.Location[] = [];
					guruOutput.value.typespos.forEach(ref => {
						let match = /^(.*):(\d+):(\d+)/.exec(ref.objpos);
						if (!match)  {
							return;
						}
						let [_, file, line, col] = match;
						let referenceResource = vscode.Uri.file(file);
						let pos = new vscode.Position(parseInt(line) - 1, parseInt(col) - 1);
						results.push(new vscode.Location(referenceResource, pos));
					});

					resolve(results);
				} catch (e) {
					reject(e);
				}
			});
			if (process.pid) {
				process.stdin.end(getFileArchive(document));
			}
			token.onCancellationRequested(() =>
				killTree(process.pid)
			);
		});
	}
}
