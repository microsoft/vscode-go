/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import vscode = require('vscode');
import { Edit, FilePatch, getEditsFromUnifiedDiffStr, isDiffToolAvailable } from './diffUtils';
import { promptForMissingTool } from './goInstallTools';
import { outputChannel } from './goStatus';
import { byteOffsetAt, canonicalizeGOPATHPrefix, getBinPath, getGoConfig, getToolsEnvVars, killTree } from './util';

export class GoRenameProvider implements vscode.RenameProvider {
	public provideRenameEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		newName: string,
		token: vscode.CancellationToken
	): Thenable<vscode.WorkspaceEdit> {
		return vscode.workspace.saveAll(false).then(() => {
			return this.doRename(document, position, newName, token);
		});
	}

	private doRename(
		document: vscode.TextDocument,
		position: vscode.Position,
		newName: string,
		token: vscode.CancellationToken
	): Thenable<vscode.WorkspaceEdit> {
		return new Promise<vscode.WorkspaceEdit>((resolve, reject) => {
			const filename = canonicalizeGOPATHPrefix(document.fileName);
			const range = document.getWordRangeAtPosition(position);
			const pos = range ? range.start : position;
			const offset = byteOffsetAt(document, pos);
			const env = getToolsEnvVars();
			const gorename = getBinPath('gorename');
			const buildTags = getGoConfig(document.uri)['buildTags'];
			const gorenameArgs = ['-offset', filename + ':#' + offset, '-to', newName];
			if (buildTags) {
				gorenameArgs.push('-tags', buildTags);
			}
			const canRenameToolUseDiff = isDiffToolAvailable();
			if (canRenameToolUseDiff) {
				gorenameArgs.push('-d');
			}

			let p: cp.ChildProcess;
			if (token) {
				token.onCancellationRequested(() => killTree(p.pid));
			}

			p = cp.execFile(gorename, gorenameArgs, { env }, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool('gorename');
						return reject('Could not find gorename tool.');
					}
					if (err) {
						const errMsg = stderr ? 'Rename failed: ' + stderr.replace(/\n/g, ' ') : 'Rename failed';
						console.log(errMsg);
						outputChannel.appendLine(errMsg);
						outputChannel.show();
						return reject();
					}

					const result = new vscode.WorkspaceEdit();

					if (canRenameToolUseDiff) {
						const filePatches = getEditsFromUnifiedDiffStr(stdout);
						filePatches.forEach((filePatch: FilePatch) => {
							const fileUri = vscode.Uri.file(filePatch.fileName);
							filePatch.edits.forEach((edit: Edit) => {
								edit.applyUsingWorkspaceEdit(result, fileUri);
							});
						});
					}

					return resolve(result);
				} catch (e) {
					reject(e);
				}
			});
		});
	}
}
