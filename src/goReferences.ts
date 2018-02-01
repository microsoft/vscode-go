/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath, byteOffsetAt, canonicalizeGOPATHPrefix, getFileArchive, getToolsEnvVars } from './util';
import { promptForMissingTool } from './goInstallTools';
import { ChildProcess } from 'child_process';

export class GoReferenceProvider implements vscode.ReferenceProvider {

	public provideReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return this.doFindReferences(document, position, options, token);
	}

	private runGoReference(document: vscode.TextDocument, position: vscode.Position, filename: string, cwd: string, options: { includeDeclaration: boolean }, resolve: any, reject: any): ChildProcess {
		// get current word
		let wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return null;
		}
		let textAtPosition = document.getText(wordRange);
		let wordLength = textAtPosition.length;
		let start = wordRange.start;
		let possibleDot = '';
		if (start.character > 0) {
			possibleDot = document.getText(new vscode.Range(start.line, start.character - 1, start.line, start.character));
		}
		if (possibleDot === '.') {
			let previousWordRange = document.getWordRangeAtPosition(new vscode.Position(start.line, start.character - 1));
			let textAtPreviousPosition = document.getText(previousWordRange);
			wordLength += textAtPreviousPosition.length + 1;
		}

		let offset = byteOffsetAt(document, position);

		let gofindreferences = getBinPath('go-find-references');
		let env = getToolsEnvVars();
		return cp.execFile(gofindreferences, ['-file', filename, '-offset', offset.toString(), '-root', vscode.workspace.rootPath], { env }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					vscode.window.showInformationMessage('The "go-find-references" command is not available.  Use "go get -v github.com/lukehoban/go-find-references" to install.');
					return resolve(null);
				}
				let lines = stdout.toString().split('\n');
				const results: vscode.Location[] = lines.map((line) => {
					const match = /(.*):(\d+):(\d+)/.exec(line);
					if (!match) return;
					let [_, file, lineStr, colStr] = match;
					let referenceResource = vscode.Uri.file(path.resolve(cwd, file));
					let range = new vscode.Range(
						+lineStr - 1, +colStr - 1, +lineStr - 1, +colStr + wordLength - 1
					);
					return new vscode.Location(referenceResource, range);
				})
				.filter((result) => result !== undefined);
				resolve(results);
			} catch (e) {
				reject(e);
			}
		});
	}

	private runGuru(document: vscode.TextDocument, position: vscode.Position, filename: string, cwd: string, options: { includeDeclaration: boolean }, resolve: any, reject: any): ChildProcess {
		let goGuru = getBinPath('guru');
		if (!path.isAbsolute(goGuru)) {
			promptForMissingTool('guru');
			return null;
		}
		let offset = byteOffsetAt(document, position);
		let env = getToolsEnvVars();
		let buildTags = vscode.workspace.getConfiguration('go', document.uri)['buildTags'];
		let args = buildTags ? ['-tags', buildTags] : [];
		args.push('-modified', 'referrers', `${filename}:#${offset.toString()}`);
		return cp.execFile(goGuru, args, { env }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('guru');
					return reject('Cannot find tool "guru" to find references.');
				}

				if (err && (<any>err).killed !== true) {
					return reject(`Error running guru: ${err.message || stderr}`);
				}

				let lines = stdout.toString().split('\n');
				let results: vscode.Location[] = [];
				for (let i = 0; i < lines.length; i++) {
					let match = /^(.*):(\d+)\.(\d+)-(\d+)\.(\d+):/.exec(lines[i]);
					if (!match) continue;
					let [_, file, lineStartStr, colStartStr, lineEndStr, colEndStr] = match;
					let referenceResource = vscode.Uri.file(path.resolve(cwd, file));

					if (!options.includeDeclaration) {
						if (document.uri.fsPath === referenceResource.fsPath &&
							position.line === Number(lineStartStr) - 1) {
							continue;
						}
					}

					let range = new vscode.Range(
						+lineStartStr - 1, +colStartStr - 1, +lineEndStr - 1, +colEndStr
					);
					results.push(new vscode.Location(referenceResource, range));
				}
				resolve(results);
			} catch (e) {
				reject(e);
			}
		});
	}

	private doFindReferences(document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
		return new Promise<vscode.Location[]>((resolve, reject) => {
			let filename = canonicalizeGOPATHPrefix(document.fileName);
			let cwd = path.dirname(filename);
			let f = vscode.workspace.getConfiguration('go', document.uri)['legacyReference'] ? this.runGoReference : this.runGuru;
			let process = f(document, position, filename, cwd, options, resolve, reject);
			if (!process) {
				return reject('Cannot find tool to find references.');
			}
			process.stdin.end(getFileArchive(document));
			token.onCancellationRequested(() =>
				process.kill()
			);
		});
	}

}
