/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { byteOffsetAt, getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';
import { getGoVersion, SemVersion, goKeywords, isPositionInString } from './util';

export interface GoDefinitionInformtation {
	file: string;
	line: number;
	column: number;
	doc: string;
	declarationlines: string[];
	name: string;
	toolUsed: string;
}

export function definitionLocation(document: vscode.TextDocument, position: vscode.Position, goConfig: vscode.WorkspaceConfiguration, includeDocs = true): Promise<GoDefinitionInformtation> {
	let wordRange = document.getWordRangeAtPosition(position);
	let lineText = document.lineAt(position.line).text;
	let word = wordRange ? document.getText(wordRange) : '';
	if (!wordRange || lineText.startsWith('//') || isPositionInString(document, position) || word.match(/^\d+.?\d+$/) || goKeywords.indexOf(word) > 0) {
		return Promise.resolve(null);
	}
	if (!goConfig) {
		goConfig = vscode.workspace.getConfiguration('go');
	}
	let toolForDocs = goConfig['docsTool'] || 'godoc';
	let offset = byteOffsetAt(document, position);
	return getGoVersion().then((ver: SemVersion) => {
		// If no Go version can be parsed, it means it's a non-tagged one.
		// Assume it's > Go 1.5
		if (toolForDocs === 'godoc' || (ver && (ver.major < 1 || (ver.major === 1 && ver.minor < 6)))) {
			return definitionLocation_godef(document, position, offset, includeDocs);
		}
		return definitionLocation_gogetdoc(document, position, offset);
	});
}

function definitionLocation_godef(document: vscode.TextDocument, position: vscode.Position, offset: number, includeDocs = true): Promise<GoDefinitionInformtation> {
	return new Promise<GoDefinitionInformtation>((resolve, reject) => {
		let godef = getBinPath('godef');

		// Spawn `godef` process
		let p = cp.execFile(godef, ['-t', '-i', '-f', document.fileName, '-o', offset.toString()], {}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('godef');
					return reject();
				}
				if (err) {
					return reject(err);
				};
				let result = stdout.toString();
				let lines = result.split('\n');
				let match = /(.*):(\d+):(\d+)/.exec(lines[0]);
				if (!match) {
					// TODO: Gotodef on pkg name:
					// /usr/local/go/src/html/template\n
					return resolve(null);
				}
				let [_, file, line, col] = match;
				let signature = lines[1];
				let godoc = getBinPath('godoc');
				let pkgPath = path.dirname(file);
				let definitionInformation: GoDefinitionInformtation = {
					file: file,
					line: +line - 1,
					column: + col - 1,
					declarationlines: lines.splice(1),
					toolUsed: 'godef',
					doc: null,
					name: null
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
					if (doc !== '') {
						definitionInformation.doc = doc;
					}
					return resolve(definitionInformation);
				});
			} catch (e) {
				reject(e);
			}
		});
		p.stdin.end(document.getText());
	});
}

function definitionLocation_gogetdoc(document: vscode.TextDocument, position: vscode.Position, offset: number): Promise<GoDefinitionInformtation> {
	return new Promise<GoDefinitionInformtation>((resolve, reject) => {
		let gogetdoc = getBinPath('gogetdoc');
		let p = cp.execFile(gogetdoc, ['-u', '-json', '-modified', '-pos', document.fileName + ':#' + offset.toString()], {}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('gogetdoc');
					return reject();
				}
				if (err) {
					return reject(err);
				};
				let goGetDocOutput = <GoGetDocOuput>JSON.parse(stdout.toString());
				let match = /(.*):(\d+):(\d+)/.exec(goGetDocOutput.pos);
				let definitionInfo = {
					file: null,
					line: 0,
					column: 0,
					toolUsed: 'gogetdoc',
					declarationlines: goGetDocOutput.decl.split('\n'),
					doc: goGetDocOutput.doc,
					name: goGetDocOutput.name
				};
				if (!match) {
					return resolve(definitionInfo);
				}
				let [_, file, line, col] = match;
				definitionInfo.file = match[1];
				definitionInfo.line = +match[2] - 1;
				definitionInfo.column = +match[3] - 1;
				return resolve(definitionInfo);

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
	private goConfig = null;

	constructor(goConfig?: vscode.WorkspaceConfiguration) {
		this.goConfig = goConfig;
	}

	public provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Location> {
		return definitionLocation(document, position, this.goConfig, false).then(definitionInfo => {
			if (definitionInfo == null || definitionInfo.file == null) return null;
			let definitionResource = vscode.Uri.file(definitionInfo.file);
			let pos = new vscode.Position(definitionInfo.line, definitionInfo.column);
			return new vscode.Location(definitionResource, pos);
		}, err => {
			if (err) {
				console.log(err);
			}
			return Promise.resolve(null);
		});
	}
}

interface GoGetDocOuput {
	name: string;
	import: string;
	decl: string;
	doc: string;
	pos: string;
}
