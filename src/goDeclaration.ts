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

		let guru = getBinPath('guru');

		// Spawn `guru` process
		let p = cp.execFile(guru, ['definition', document.fileName + ':#' + offset.toString()], {}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('guru');
				}
				if (err) return resolve(null);
				let result = stdout.toString();
				let lines = result.split('\n');
				let match = /(.*):(\d+):(\d+): defined here as (.*)$/.exec(lines[0]);
				if (!match) {
					// TODO: Gotodef on pkg name:
					// /usr/local/go/src/html/template\n
					return resolve(null);
				}
				let [_, file, line, col, sig] = match;
				let definitionInformation: GoDefinitionInformtation = {
					file: file,
					line: +line - 1,
					col: + col - 1,
					lines: [sig],
					doc: undefined
				};
				let source = fs.readFileSync(definitionInformation.file, 'utf8');
				lines = source.split('\n');
				addLinesToDefinition(definitionInformation, lines);
				if (includeDocs) {
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

function addLinesToDefinition(defInfo: GoDefinitionInformtation, lines: string[]) {
	let line = lines[defInfo.line];
	// Keep only the signature of funcs and single line definitions.
	if (line.startsWith('func') || !line.match('\{\s*$')) {
		line = line.replace(/\s*\{\s*$/, '');
		defInfo.lines = [line];
	} else {
		// Handle definitions with multiple lines
		defInfo.lines = [];
		for (let i = defInfo.line; i < lines.length; i++) {
			defInfo.lines.push(lines[i]);
			if (lines[i].trim() == '}') {
				break;
			}
		}
	}
	defInfo.lines = unindent(defInfo.lines);
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

// Uniformly trims leadings tabs.
function unindent(lines: string[]): string[] {
	// find the minimum amount of leading tabs
	let minWhitespace = 999;
	for (let i = 0; i < lines.length; i++) {
		let l = /^\t*/.exec(lines[i])[0].length;
		if (l < minWhitespace) {
			minWhitespace = l;
		}
	}
	// trim the minimum amount from all lines
	let out = [];
	for (let i = 0; i < lines.length; i++) {
		out.push(lines[i].substr(minWhitespace));
	}
	return out;
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
