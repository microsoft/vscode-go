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
import { getGoVersion, SemVersion, goKeywords, isPositionInString, getToolsEnvVars, getFileArchive } from './util';

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

export class DefinitionHelper {
	private currentRunningProcess: cp.ChildProcess;

	private isPositionValid(document: vscode.TextDocument, position: vscode.Position): boolean {
		let wordRange = document.getWordRangeAtPosition(position);
		let lineText = document.lineAt(position.line).text;
		let word = wordRange ? document.getText(wordRange) : '';
		if (!wordRange || lineText.startsWith('//') || isPositionInString(document, position) || word.match(/^\d+.?\d+$/) || goKeywords.indexOf(word) > 0) {
			return false;
		}
		return true;
	}

	private getDefinitionTool(goConfig: vscode.WorkspaceConfiguration) {
		let toolForDocs = goConfig['docsTool'] || 'godoc';
		return getGoVersion().then((ver: SemVersion) => {
			// If no Go version can be parsed, it means it's a non-tagged one.
			// Assume it's > Go 1.5
			if (toolForDocs === 'godoc' || (ver && (ver.major < 1 || (ver.major === 1 && ver.minor < 6)))) {
				return 'godef';
			}
			return toolForDocs === 'guru' ? 'guru' : 'gogetdoc';
		});
	}

	public cancelCurrentRunningProcess() {
		try {
			if (this.currentRunningProcess) {
				this.currentRunningProcess.kill();
				this.currentRunningProcess = null;
			}
		} catch (e) {
			console.log(e)
		}
	}

	public definitionLocation(document: vscode.TextDocument, position: vscode.Position, goConfig: vscode.WorkspaceConfiguration, includeDocs = true): Promise<GoDefinitionInformation> {
		if (!this.isPositionValid(document, position)) {
			return Promise.resolve(null);
		}

		goConfig = goConfig || vscode.workspace.getConfiguration('go', document.uri);
		return this.getDefinitionTool(goConfig).then(tool => {
			const binaryPath = getBinPath(tool);
			if (!path.isAbsolute(binaryPath)) {
				return Promise.reject(missingToolMsg + tool);
			}

			let buildTags = goConfig['buildTags'];
			let offset = byteOffsetAt(document, position);
			let env = getToolsEnvVars();
			let args: string[];
			let callback: (stdout: string) => GoDefinitionInformation;

			switch (tool) {
				case 'godef':
					args = ['-t', '-i', '-f', document.fileName, '-o', offset.toString()];
					callback = this.godefCallback;
					break;
				case 'guru':
					args = ['-json', '-modified', 'definition', document.fileName + ':#' + offset.toString()];
					callback = this.guruCallback;
					break;
				case 'gogetdoc':
					args = ['-u', '-json', '-modified', '-pos', document.fileName + ':#' + offset.toString()];
					if (buildTags) {
						args.push('-tags', '"' + buildTags + '"');
					}
					callback = this.gogetdocCallback;
					break;
				default:
					break;
			}

			if (!args || !callback) {
				return Promise.resolve(null);
			}

			this.cancelCurrentRunningProcess();
			return new Promise<GoDefinitionInformation>((resolve, reject) => {
				this.currentRunningProcess = cp.execFile(binaryPath, args, { env }, (err, stdout, stderr) => {
					if (err) {
						return reject(err);
					}

					let definitionInformation: GoDefinitionInformation;
					try {
						definitionInformation = callback(stdout);
					} catch (e) {
						return reject(e);
					}

					if (tool !== 'godef' || !includeDocs || !definitionInformation.declarationlines || !definitionInformation.declarationlines.length) {
						return resolve(definitionInformation);
					}

					// godef doesnt provide docs, so we call godoc
					let pkgPath = path.dirname(definitionInformation.file);
					let signature = definitionInformation.declarationlines[0];
					let godoc = getBinPath('godoc');
					this.currentRunningProcess = cp.execFile(godoc, [pkgPath], { env }, (err, stdout, stderr) => {
						if (err && (<any>err).code === 'ENOENT') {
							vscode.window.showInformationMessage('The "godoc" command is not available.');
							return resolve(definitionInformation);
						}
						try {
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
						} catch (e) {
							return reject(e);
						}
						return resolve(definitionInformation);
					});
				});
				this.currentRunningProcess.stdin.end(tool === 'godef' ? document.getText() : getFileArchive(document));
			});
		});
	}



	private godefCallback(stdout: string): GoDefinitionInformation {
		let result = stdout.toString();
		let lines = result.split('\n');
		let match = /(.*):(\d+):(\d+)/.exec(lines[0]);
		if (!match) {
			// TODO: Gotodef on pkg name:
			// /usr/local/go/src/html/template\n
			return null;
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
		return definitionInformation;
	}

	private guruCallback(stdout: string): GoDefinitionInformation {
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
			return definitionInfo;
		}
		let [_, file, line, col] = match;
		definitionInfo.file = match[1];
		definitionInfo.line = +match[2] - 1;
		definitionInfo.column = +match[3] - 1;
		return definitionInfo;
	}

	private gogetdocCallback(stdout: string): GoDefinitionInformation {
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
			return definitionInfo;
		}
		let [_, file, line, col] = match;
		definitionInfo.file = match[1];
		definitionInfo.line = +match[2] - 1;
		definitionInfo.column = +match[3] - 1;
		return definitionInfo;
	}
}

export class GoDefinitionProvider implements vscode.DefinitionProvider {
	private goConfig = null;
	private helper: DefinitionHelper;

	constructor(goConfig?: vscode.WorkspaceConfiguration) {
		this.goConfig = goConfig;
		this.helper = new DefinitionHelper();
	}

	public provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Location> {
		token.onCancellationRequested(this.helper.cancelCurrentRunningProcess);

		return this.helper.definitionLocation(document, position, this.goConfig, false).then(definitionInfo => {
			if (definitionInfo == null || definitionInfo.file == null) return null;
			let definitionResource = vscode.Uri.file(definitionInfo.file);
			let pos = new vscode.Position(definitionInfo.line, definitionInfo.column);
			return new vscode.Location(definitionResource, pos);
		}, err => {
			// Prompt for missing tool is located here so that the
			// prompts dont show up on hover or signature help
			if (err && typeof err === 'string' && err.startsWith(missingToolMsg)) {
				promptForMissingTool(err.substr(missingToolMsg.length));
			}
			console.log(err);
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