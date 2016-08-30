/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath } from './goPath';
import { byteOffsetAt, canonicalizeGOPATHPrefix, EditTypes, ParseDiffOutput } from './util';
import { promptForMissingTool } from './goInstallTools';

export class GoRenameProvider implements vscode.RenameProvider {

	public provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Thenable<vscode.WorkspaceEdit> {
		return vscode.workspace.saveAll(false).then(() => {
			return this.doRename(document, position, newName, token);
		});
	}

	private doRename(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Thenable<vscode.WorkspaceEdit> {
		return new Promise<vscode.WorkspaceEdit>((resolve, reject) => {
			let filename = canonicalizeGOPATHPrefix(document.fileName);
			let range = document.getWordRangeAtPosition(position);
			let pos = range ? range.start : position;
			let offset = byteOffsetAt(document, pos);

			let gorename = getBinPath('gorename');
			let buildTags = '"' + vscode.workspace.getConfiguration('go')['buildTags'] + '"';

			cp.execFile(gorename, ['-d', '-offset', filename + ':#' + offset, '-to', newName, '-tags', buildTags], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool('gorename');
						return resolve(null);
					}
					if (err) return reject('Cannot rename due to errors: ' + stderr);

					let allFilePatches = ParseDiffOutput(stdout);
					let result = new vscode.WorkspaceEdit();

					allFilePatches.forEach(filePatch => {
						if (!filePatch.uri){
							reject("Couldnt parse the file path from the gorename output");
						}
						if (!filePatch.edits){
							reject("Couldnt parse the diffs from the gorename output")
						}
						filePatch.edits.forEach(edit => {
							edit.applyToWorkspaceEdit(result, filePatch.uri);
						});
					});

					return resolve(result);
				} catch (e) {
					reject(e);
				}
			});
		});
	}

}
