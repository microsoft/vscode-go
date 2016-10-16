/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import fs = require('fs');
import path = require('path');
import { getBinPath } from './goPath';
import { byteOffsetAt } from './util';
import { promptForMissingTool } from './goInstallTools';

export interface GoDefinitionInformtation {
	file: string;
	line: number;
	col: number;
	lines: string[];
	doc: string;
}

export function definitionLocation(document: vscode.TextDocument, position: vscode.Position, includeDocs = true): Promise<GoDefinitionInformtation> {
	return new Promise<GoDefinitionInformtation>((resolve, reject) => {

		let wordAtPosition = document.getWordRangeAtPosition(position);
		let offset = byteOffsetAt(document, position);

		let godef = getBinPath('godef');

		// Spawn `godef` process
		let p = cp.execFile(godef, ['-t', '-i', '-f', document.fileName, '-o', offset.toString()], {}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('godef');
				}
				if (err) return resolve(null);
				let result = stdout.toString();
				let lines = result.split('\n');
				let match = /(.*):(\d+):(\d+)/.exec(lines[0]);
				if (!match) {
					// TODO: Gotodef on pkg name:
					// /usr/local/go/src/html/template\n
					return resolve(null);
				}
				let [_, file, line, col] = match;
				let definitionInformation: GoDefinitionInformtation = {
					file: file,
					line: +line - 1,
					col: + col - 1,
					lines,
					doc: undefined
				};
				if (includeDocs) {
					let source = fs.readFileSync(definitionInformation.file, 'utf8');
					let lines = source.split('\n');
					addDocToDefinition(definitionInformation, lines);
				}
				return resolve(definitionInformation);
			} catch (e) {
				reject(e);
			}
		});
		p.stdin.end(document.getText());
	});
}

function addDocToDefinition(defInfo: GoDefinitionInformtation, lines: string[]) {
	let doc = '';
	// gather comments above the definition
	for (let i = defInfo.line - 1; i >= 0; i--) {
		let line = lines[i];
		if (line.substr(0, 2) != '//') {
			break;
		}
		doc = line + '\n' + doc
	}
	// otherwise look for documentation on the same line
	if (doc == '') {
		let line = lines[defInfo.line];
		let docPos = line.indexOf('//', 1);
		if (docPos > 1) {
			doc = line.substr(docPos);
		}
	}
	// trim trailing \n
	doc = doc.trim();
	// trim leading '// ' or '//' per line
	doc = doc.replace(/^\/\//gm, '');
	defInfo.doc = doc
}

export class GoDefinitionProvider implements vscode.DefinitionProvider {

	public provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Location> {
		return definitionLocation(document, position, false).then(definitionInfo => {
			if (definitionInfo == null) return null;
			let definitionResource = vscode.Uri.file(definitionInfo.file);
			let pos = new vscode.Position(definitionInfo.line, definitionInfo.col);
			return new vscode.Location(definitionResource, pos);
		});
	}

}
