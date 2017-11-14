'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getEdits } from './diffUtils';
import { promptForMissingTool } from './goInstallTools';
import { getBinPath, getToolsEnvVars } from './util';

export function runExpanderr(): Thenable<string> {
	return new Promise<string>((resolve, reject) => {
		try {
			let editor = vscode.window.activeTextEditor;

			if (!editor) {
				vscode.window.showInformationMessage('No editor selected.');
				return reject('No editor selected.');
			}

			if (!editor.document.fileName.endsWith('.go')) {
				vscode.window.showInformationMessage('File in the editor is not a Go file.');
				return reject('File in the editor is not a Go file.');
			}

			if (editor.document.isDirty) {
				vscode.window.showInformationMessage('File has unsaved changes. Save and try again.');
				return reject('File has unsaved changes. Save and try again.');
			}

			let filename = editor.document.uri.fsPath;
			let offset = editor.document.offsetAt(editor.selection.start);

			let binPath = getBinPath('expanderr');
			let goConfig = vscode.workspace.getConfiguration('go', editor.document.uri);
			let env = getToolsEnvVars();

			cp.execFile(binPath, [filename + ':#' + offset], {env}, (err, stdout, stderr) => {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('expanderr');
					return reject('Missing tool: expanderr');
				}

				if (err) {
					console.log(err);
					return reject('Cannot format due to syntax errors.');
				};

				let workspaceEdit = new vscode.WorkspaceEdit();
				let filePatch = getEdits(filename, editor.document.getText(), stdout);
				filePatch.edits.forEach((edit) => {
					edit.applyUsingWorkspaceEdit(workspaceEdit, editor.document.uri);
				});
				vscode.workspace.applyEdit(workspaceEdit);

				return resolve('Success');
			});
		} catch (e) {
			reject(e);
		}
	});
}
