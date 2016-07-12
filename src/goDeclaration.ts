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

export interface GoDefinitionInformation {
	file: string;
	line: number;
	col: number;
	doc: string;
	objpos: string;
	desc: string;
}

export interface GuruDefinitionResult {
	objpos: string;
	desc: string;
}

export function definitionLocation(document: vscode.TextDocument, position: vscode.Position, includeDocs = true): Promise<GoDefinitionInformation> {
	return new Promise<GoDefinitionInformation>((resolve, reject) => {
		let wordAtPosition = document.getWordRangeAtPosition(position);
		let offset = byteOffsetAt(document, position);

		let guru = getBinPath('guru');

		// Spawn `guru` process
		let p = cp.execFile(guru, ['-json', 'definition', document.fileName + ':#' + offset.toString()], {}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					vscode.window.showInformationMessage('The "guru" command is not available.  Use "go get -u golang.org/x/tools/cmd/guru" to install.');
				}
				if (err) return resolve(null);
				let result = stdout.toString();
				let def = <GuruDefinitionResult>JSON.parse(result);
				let match = /(.*):(\d+):(\d+)/.exec(def.objpos);
				if (!match) {
					// TODO: Gotodef on pkg name:
					// /usr/local/go/src/html/template\n
					return resolve(null);
				}
				let [_, file, line, col] = match;
				let signature = def.desc;
				let godoc = getBinPath('godoc');
				let pkgPath = path.dirname(file);
				let definitionInformation: GoDefinitionInformation = {
					file: file,
					line: +line - 1,
					col: + col - 1,
					objpos: def.objpos,
					desc: def.desc,
					doc: undefined
				};
				if (!includeDocs) {
					return resolve(definitionInformation);
				}
				cp.execFile(godoc, [pkgPath], {}, (err, stdout, stderr) => {
					if (err && (<any>err).code === 'ENOENT') {
						vscode.window.showInformationMessage('The "godoc" command is not available.');
					}
					let godocLines = stdout.toString().split('\n');
					let doc = '';
					let sigName = signature.substring(0, signature.indexOf(' '));
					let sigParams = signature.substring(signature.indexOf(' func') + 5);
					let searchSignature = 'func ' + sigName + sigParams;
					for (let i = 0; i < godocLines.length; i++) {
						if (godocLines[i] === searchSignature) {
							while (godocLines[++i].startsWith('    ')) {
								doc += godocLines[i].substring(4) + '\n';
							}
							break;
						}
					}
					definitionInformation.doc = doc;
					return resolve(definitionInformation);
				});
			} catch (e) {
				reject(e);
			}
		});
		p.stdin.end(document.getText());
	});
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
