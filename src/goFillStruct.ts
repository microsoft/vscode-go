/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { byteOffsetAt, getBinPath, getFileArchive, getToolsEnvVars } from './util';
import cp = require('child_process');
import { promptForMissingTool } from './goInstallTools';

// Interface for the output from fillstruct
interface GoFillStructOutput {
	start: number;
	end: number;
	code: string;
}

export function runFillStruct(editor: vscode.TextEditor): Promise<void> {
	let args = getCommonArgs(editor);
	if (!args) {
		return Promise.reject('No args');
	}

	return execFillStruct(editor, args);
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
	if (editor.selection.isEmpty) {
		let offset = byteOffsetAt(editor.document, editor.selection.start);
		args.push('-offset');
		args.push(offset.toString());
	} else {
		args.push('-line');
		args.push(`${editor.selection.start.line + 1}`);
	}
	return args;
}

function getTabsCount(editor: vscode.TextEditor): number {
	let startline = editor.selection.start.line;
	let tabs = editor.document.lineAt(startline).text.match('^\t*');
	return tabs.length;
}

function execFillStruct(editor: vscode.TextEditor, args: string[]): Promise<void> {
	let fillstruct = getBinPath('fillstruct');
	let input = getFileArchive(editor.document);
	let tabsCount = getTabsCount(editor);

	return new Promise<void>((resolve, reject) => {
		let p = cp.execFile(fillstruct, args, { env: getToolsEnvVars() }, (err, stdout, stderr) => {
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

				editor.edit(editBuilder => {
					output.forEach((structToFill) => {
						const out = structToFill.code.replace(/\n/g, '\n' + indent);
						const rangeToReplace = new vscode.Range(editor.document.positionAt(structToFill.start),
							editor.document.positionAt(structToFill.end));
						editBuilder.replace(rangeToReplace, out);
					});
				}).then(() => resolve());
			} catch (e) {
				reject(e);
			}
		});
		p.stdin.end(input);
	});
}
