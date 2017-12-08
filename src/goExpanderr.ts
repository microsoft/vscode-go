'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getEdits } from './diffUtils';
import { promptForMissingTool } from './goInstallTools';
import { getBinPath, getToolsEnvVars } from './util';

/**
 * Runs expanderr and applies the changes on the file in the current editor
 */
export function expanderrCommand() {
	let editor = vscode.window.activeTextEditor;

	if (!editor) {
		vscode.window.showInformationMessage('No editor selected.');
		return;
	}

	if (!editor.document.fileName.endsWith('.go')) {
		vscode.window.showInformationMessage('File in the editor is not a Go file.');
		return;
	}

	if (editor.document.isDirty) {
		vscode.window.showInformationMessage('File has unsaved changes. Save and try again.');
		return;
	}

	return runExpanderr(editor).then(updatedText => {
		let workspaceEdit = new vscode.WorkspaceEdit();
		let filename = editor.document.uri.fsPath;
		let filePatch = getEdits(filename, editor.document.getText(), updatedText);
		filePatch.edits.forEach((edit) => {
			edit.applyUsingWorkspaceEdit(workspaceEdit, editor.document.uri);
		});
		return vscode.workspace.applyEdit(workspaceEdit);
	}, (err: string) => {
		if (err) {
			return vscode.window.showErrorMessage(err);
		}
	});
}

/**
 * Runs expanderr on the file contents of current editor and returns updated file contents
 * @param editor
 */
export function runExpanderr(editor: vscode.TextEditor): Thenable<string> {

	return new Promise<string>((resolve, reject) => {
		let filename = editor.document.uri.fsPath;
		let offset = editor.document.offsetAt(editor.selection.start);

		let binPath = getBinPath('expanderr');
		let goConfig = vscode.workspace.getConfiguration('go', editor.document.uri);
		let env = getToolsEnvVars();

		cp.execFile(binPath, [filename + ':#' + offset], { env }, (err, stdout, stderr) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool('expanderr');
				return reject();
			}

			if (stderr) {
				return reject(stderr);
			};

			return resolve(stdout);
		});
	});
}


