/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath } from './goPath';
import { byteOffsetAt } from './util';
import { promptForMissingTool } from './goInstallTools';

export interface GoDefinitionInformtation {
	file: string;
	line: number;
	column: number;
	docInfo: GoDocInfomation;
}

export function definitionLocation(document: vscode.TextDocument, position: vscode.Position, includeDocs = true): Promise<GoDefinitionInformtation> {
	return new Promise<GoDefinitionInformtation>((resolve, reject) => {
		let wordAtPosition = document.getWordRangeAtPosition(position);
		let offset = byteOffsetAt(document, position);
		let gogetdoc = getBinPath('gogetdoc');
		let p = cp.execFile(gogetdoc, ['-u', '-json', '-modified', '-pos', document.fileName + ':#' + offset.toString()], {}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('gogetdoc');
				}
				if (err) return resolve(null);
				let goDocInfomation = <GoDocInfomation>JSON.parse(stdout.toString());
				let match = /(.*):(\d+):(\d+)/.exec(goDocInfomation.pos);
				if (!match) {
					return resolve({
						file: null,
						line: 0,
						column: 0,
						docInfo: goDocInfomation
					});
				}
				let [_, file, line, col] = match;
				return resolve({
					file: file,
					line: +line - 1,
					column: +col - 1,
					docInfo: goDocInfomation
				});
			} catch (e) {
				reject(e);
			}
		});
		let documentText = document.getText();
		let documentArchive = document.fileName + '\n';
		documentArchive = documentArchive + Buffer.byteLength(documentText) + '\n';
		documentArchive = documentArchive + documentText;
		p.stdin.end(documentArchive);
	});
}

export class GoDefinitionProvider implements vscode.DefinitionProvider {
	public provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Location> {
		return definitionLocation(document, position, false).then(definitionInfo => {
			if (definitionInfo == null || definitionInfo.file == null) return null;
			let definitionResource = vscode.Uri.file(definitionInfo.file);
			let pos = new vscode.Position(definitionInfo.line, definitionInfo.column);
			return new vscode.Location(definitionResource, pos);
		});
	}
}

interface GoDocInfomation {
	name: string;
	import: string;
	decl: string;
	doc: string;
	pos: string;
}
