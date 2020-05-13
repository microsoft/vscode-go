/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import { adjustWordPosition, definitionLocation, parseMissingError } from './goDeclaration';
import { promptForMissingTool } from './goInstallTools';
import {
	byteOffsetAt,
	canonicalizeGOPATHPrefix,
	getBinPath,
	getFileArchive,
	getGoConfig,
	getToolsEnvVars,
	goBuiltinTypes,
	killTree
} from './util';

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
	public provideTypeDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.Definition> {
		const adjustedPos = adjustWordPosition(document, position);
		if (!adjustedPos[0]) {
			return Promise.resolve(null);
		}
		position = adjustedPos[2];

		return new Promise<vscode.Definition>((resolve, reject) => {
			const goGuru = getBinPath('guru');
			if (!path.isAbsolute(goGuru)) {
				promptForMissingTool('guru');
				return reject('Cannot find tool "guru" to find type definitions.');
			}

			const filename = canonicalizeGOPATHPrefix(document.fileName);
			const offset = byteOffsetAt(document, position);
			const env = getToolsEnvVars();
			const buildTags = getGoConfig(document.uri)['buildTags'];
			const args = buildTags ? ['-tags', buildTags] : [];
			args.push('-json', '-modified', 'describe', `${filename}:#${offset.toString()}`);

			const process = cp.execFile(goGuru, args, { env }, (guruErr, stdout, stderr) => {
				try {
					if (guruErr && (<any>guruErr).code === 'ENOENT') {
						promptForMissingTool('guru');
						return resolve(null);
					}

					if (guruErr) {
						return reject(guruErr);
					}

					const guruOutput = <GuruDescribeOutput>JSON.parse(stdout.toString());
					if (!guruOutput.value || !guruOutput.value.typespos) {
						if (
							guruOutput.value &&
							guruOutput.value.type &&
							!goBuiltinTypes.has(guruOutput.value.type) &&
							guruOutput.value.type !== 'invalid type'
						) {
							console.log(`no typespos from guru's output - try to update guru tool`);
						}

						// Fall back to position of declaration
						return definitionLocation(document, position, null, false, token).then(
							(definitionInfo) => {
								if (definitionInfo == null || definitionInfo.file == null) {
									return null;
								}
								const definitionResource = vscode.Uri.file(definitionInfo.file);
								const pos = new vscode.Position(definitionInfo.line, definitionInfo.column);
								resolve(new vscode.Location(definitionResource, pos));
							},
							(err) => {
								const miss = parseMissingError(err);
								if (miss[0]) {
									promptForMissingTool(miss[1]);
								} else if (err) {
									return Promise.reject(err);
								}
								return Promise.resolve(null);
							}
						);
					}

					const results: vscode.Location[] = [];
					guruOutput.value.typespos.forEach((ref) => {
						const match = /^(.*):(\d+):(\d+)/.exec(ref.objpos);
						if (!match) {
							return;
						}
						const [_, file, line, col] = match;
						const referenceResource = vscode.Uri.file(file);
						const pos = new vscode.Position(parseInt(line, 10) - 1, parseInt(col, 10) - 1);
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
			token.onCancellationRequested(() => killTree(process.pid));
		});
	}
}
