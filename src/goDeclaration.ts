/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath'
import { byteOffsetAt } from './util'

export interface GoDefinitionInformtation {
	file: string;
	line: number;
	col: number;
	lines: string[];
}

export function definitionLocation(document: vscode.TextDocument, position: vscode.Position): Promise<GoDefinitionInformtation> {
	return new Promise((resolve, reject) => {

		var wordAtPosition = document.getWordRangeAtPosition(position);
		var offset = byteOffsetAt(document, position);

		var godef = getBinPath("godef");

		// Spawn `godef` process
		var p = cp.execFile(godef, ["-t", "-i", "-f", document.fileName, "-o", offset.toString()], {}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code == "ENOENT") {
					vscode.window.showInformationMessage("The 'godef' command is not available.  Use 'go get -u github.com/rogpeppe/godef' to install.");
				}
				if (err) return resolve(null);
				var result = stdout.toString();
				var lines = result.split('\n');
				// TODO: Goto def on a package name import will return juts a plain
				// path to a folder here - can we go to a folder?
				var match = /(.*)(:(\d+):(\d+))?/.exec(lines[0]);
				if (!match) return resolve(null);
				var [_, file, line, col] = match;
				return resolve({
					file: file, 
					line: +line - 1,
					col: + col - 1, 
					lines: lines
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
		return definitionLocation(document, position).then(definitionInfo => {
			var definitionResource = vscode.Uri.file(definitionInfo.file);
			var pos = new vscode.Position(definitionInfo.line, definitionInfo.col);
			return new vscode.Location(definitionResource, pos)
		});
	}

}
