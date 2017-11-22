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
import { getGoVersion, SemVersion, goKeywords, isPositionInString, getToolsEnvVars, getFileArchive, killProcess } from './util';

const missingToolMsg = 'Missing tool: ';

export interface GoDefinitionInformation {
	file: string;
	line: number;
	column: number;
	doc: string;
	declarationlines: string[];
	name: string;
	toolUsed: string;
}

export function definitionLocation(document: vscode.TextDocument, position: vscode.Position, goConfig: vscode.WorkspaceConfiguration, includeDocs: boolean, token: vscode.CancellationToken): Promise<GoDefinitionInformation> {
	let wordRange = document.getWordRangeAtPosition(position);
	let lineText = document.lineAt(position.line).text;
	let word = wordRange ? document.getText(wordRange) : '';
	if (!wordRange || lineText.startsWith('//') || isPositionInString(document, position) || word.match(/^\d+.?\d+$/) || goKeywords.indexOf(word) > 0) {
		return Promise.resolve(null);
	}
	if (!goConfig) {
		goConfig = vscode.workspace.getConfiguration('go', document.uri);
	}
	let toolForDocs = goConfig['docsTool'] || 'godoc';
	let offset = byteOffsetAt(document, position);
	let env = getToolsEnvVars();
	return getGoVersion().then((ver: SemVersion) => {
		// If no Go version can be parsed, it means it's a non-tagged one.
		// Assume it's > Go 1.5
		if (toolForDocs === 'godoc' || (ver && (ver.major < 1 || (ver.major === 1 && ver.minor < 6)))) {
			return definitionLocation_godef(document, position, offset, includeDocs, env, token);
		} else if (toolForDocs === 'guru') {
			return definitionLocation_guru(document, position, offset, env, token);
		}
		return definitionLocation_gogetdoc(document, position, offset, env, true, token);
	});
}

function definitionLocation_godef(document: vscode.TextDocument, position: vscode.Position, offset: number, includeDocs: boolean, env: any, token: vscode.CancellationToken): Promise<GoDefinitionInformation> {
	let godef = getBinPath('godef');
	if (!path.isAbsolute(godef)) {
		return Promise.reject(missingToolMsg + 'godef');
	}
	let p: cp.ChildProcess;
	if (token) {
		token.onCancellationRequested(() => killProcess(p));
	}

	return new Promise<GoDefinitionInformation>((resolve, reject) => {
		// Spawn `godef` process
		p = cp.execFile(godef, ['-t', '-i', '-f', document.fileName, '-o', offset.toString()], { env }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					return reject(missingToolMsg + 'godef');
				}
				if (err) {
					return reject(err.message || stderr);
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
				let definitionInformation: GoDefinitionInformation = {
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
				p = cp.execFile(godoc, [pkgPath], { env }, (err, stdout, stderr) => {
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

function definitionLocation_gogetdoc(document: vscode.TextDocument, position: vscode.Position, offset: number, env: any, useTags: boolean, token: vscode.CancellationToken): Promise<GoDefinitionInformation> {
	let gogetdoc = getBinPath('gogetdoc');
	if (!path.isAbsolute(gogetdoc)) {
		return Promise.reject(missingToolMsg + 'gogetdoc');
	}
	let p: cp.ChildProcess;
	if (token) {
		token.onCancellationRequested(() => killProcess(p));
	}
	return new Promise<GoDefinitionInformation>((resolve, reject) => {

		let gogetdocFlagsWithoutTags = ['-u', '-json', '-modified', '-pos', document.fileName + ':#' + offset.toString()];
		let buildTags = vscode.workspace.getConfiguration('go', document.uri)['buildTags'];
		let gogetdocFlags = (buildTags && useTags) ? [...gogetdocFlagsWithoutTags, '-tags', buildTags] : gogetdocFlagsWithoutTags;
		p = cp.execFile(gogetdoc, gogetdocFlags, { env }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					return reject(missingToolMsg + 'gogetdoc');
				}
				if (stderr && stderr.startsWith('flag provided but not defined: -tags')) {
					p = null;
					return definitionLocation_gogetdoc(document, position, offset, env, false, token);
				}
				if (err) {
					return reject(err.message || stderr);
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
		p.stdin.end(getFileArchive(document));
	});
}

function definitionLocation_guru(document: vscode.TextDocument, position: vscode.Position, offset: number, env: any, token: vscode.CancellationToken): Promise<GoDefinitionInformation> {
	let guru = getBinPath('guru');
	if (!path.isAbsolute(guru)) {
		return Promise.reject(missingToolMsg + 'guru');
	}
	let p: cp.ChildProcess;
	if (token) {
		token.onCancellationRequested(() => killProcess(p));
	}
	return new Promise<GoDefinitionInformation>((resolve, reject) => {
		p = cp.execFile(guru, ['-json', '-modified', 'definition', document.fileName + ':#' + offset.toString()], { env }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					return reject(missingToolMsg + 'guru');
				}
				if (err) {
					return reject(err.message || stderr);
				};
				let guruOutput = <GuruDefinitionOuput>JSON.parse(stdout.toString());
				let match = /(.*):(\d+):(\d+)/.exec(guruOutput.objpos);
				let definitionInfo = {
					file: null,
					line: 0,
					column: 0,
					toolUsed: 'guru',
					declarationlines: [guruOutput.desc],
					doc: null,
					name: null,
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
		p.stdin.end(getFileArchive(document));
	});
}


export class GoDefinitionProvider implements vscode.DefinitionProvider {
	private goConfig = null;

	constructor(goConfig?: vscode.WorkspaceConfiguration) {
		this.goConfig = goConfig;
	}

	public provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Location> {
		return definitionLocation(document, position, this.goConfig, false, token).then(definitionInfo => {
			if (definitionInfo == null || definitionInfo.file == null) return null;
			let definitionResource = vscode.Uri.file(definitionInfo.file);
			let pos = new vscode.Position(definitionInfo.line, definitionInfo.column);
			return new vscode.Location(definitionResource, pos);
		}, err => {
			if (err) {
				// Prompt for missing tool is located here so that the
				// prompts dont show up on hover or signature help
				if (typeof err === 'string' && err.startsWith(missingToolMsg)) {
					promptForMissingTool(err.substr(missingToolMsg.length));
				} else {
					return Promise.reject(err);
				}
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

interface GuruDefinitionOuput {
	objpos: string;
	desc: string;
}