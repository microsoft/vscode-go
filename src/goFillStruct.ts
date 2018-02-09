/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { byteOffsetAt, getBinPath, getFileArchive, getToolsEnvVars } from './util';
import cp = require('child_process');
import { promptForMissingTool } from './goInstallTools';
import { outputChannel } from './goStatus';
import { TextEdit } from 'vscode-languageclient/lib/main';

// Interface for the output from fillstruct
interface GoFillStructOutput {
	start: number;
	end: number;
	code: string;
}

export function fillStruct() {
	let editor = vscode.window.activeTextEditor;
	return runFillStruct(editor);
}

export function runFillStruct(editor: vscode.TextEditor) {
	let args = getCommonArgs(editor);
	if (!args) {
		return;
	}

	let tabsCount = getTabsCount(editor);

	return execFillStruct(editor, args, tabsCount).then((edits) => {
		editor.edit(editBuilder => {
			edits.forEach(edit => {
				editBuilder.replace(edit.range, edit.newText);
			});
		});
	}).catch(e => {
		vscode.window.showInformationMessage(`Could not fill struct: ${e}.`);
	});
}

function getCommonArgs(editor: vscode.TextEditor): string[] {
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('.go')) {
		vscode.window.showInformationMessage('Current file is not a Go file.');
		return;
	}
	let args = ['-modified', '-file', editor.document.fileName];
	if (editor.selection.start.line === editor.selection.end.line && editor.selection.start.character === editor.selection.end.character) {
		let offset = byteOffsetAt(editor.document, editor.selection.start);
		args.push('-offset');
		args.push(offset.toString());
	} else if (editor.selection.start.line <= editor.selection.end.line) {
		args.push('-line');
		args.push(`${editor.selection.start.line + 1},${editor.selection.end.line + 1}`);
	}

	return args;
}

function getTabsCount(editor: vscode.TextEditor): number {
	let startline = editor.selection.start.line;
	let tabs = editor.document.lineAt(startline).text.match('^\t*');
	return tabs.length;
}

function execFillStruct(editor: vscode.TextEditor, args: string[], tabsCount: number): Promise<vscode.TextEdit[]> {
	let fillstruct = getBinPath('fillstruct');
	let input = getFileArchive(editor.document);

	return new Promise<vscode.TextEdit[]>((resolve, reject) => {
		let p = cp.execFile(fillstruct, args, {env: getToolsEnvVars()}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('fillstruct');
					return reject();
				}

				if (err) {
					vscode.window.showInformationMessage(`Cannot fill struct: ${stderr}`);
					return reject();
				}

				let output = <GoFillStructOutput[]>JSON.parse(stdout);

				if (output.length === 0) {
					vscode.window.showInformationMessage(`Got empty fillstruct output`);
					return reject();
				}

				let indent = '\t'.repeat(tabsCount);
				let edits: vscode.TextEdit[] = [];

				output.forEach((structToFill) => {
					let out = structToFill.code.replace(/\n/g, '\n' + indent);
					edits.push(vscode.TextEdit.replace(new vscode.Range(editor.document.positionAt(structToFill.start),
						editor.document.positionAt(structToFill.end)), out));
				});

				return resolve(edits);
			} catch (e) {
				reject(e);
			}
		});
		p.stdin.end(input);
	});
}
