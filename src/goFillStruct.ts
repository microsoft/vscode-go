/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import vscode = require('vscode');
import { promptForMissingTool } from './goInstallTools';
import { byteOffsetAt, getBinPath, getFileArchive, getToolsEnvVars, makeMemoizedByteOffsetConverter } from './util';

// Interface for the output from fillstruct
interface GoFillStructOutput {
	start: number;
	end: number;
	code: string;
}

export function runFillStruct(editor: vscode.TextEditor): Promise<void> {
	const args = getCommonArgs(editor);
	if (!args) {
		return Promise.reject('No args');
	}

	return execFillStruct(editor, args);
}

function getCommonArgs(editor: vscode.TextEditor): string[] | undefined {
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('.go')) {
		vscode.window.showInformationMessage('Current file is not a Go file.');
		return;
	}
	const args = ['-modified', '-file', editor.document.fileName];
	if (editor.selection.isEmpty) {
		const offset = byteOffsetAt(editor.document, editor.selection.start);
		args.push('-offset');
		args.push(offset.toString());
	} else {
		args.push('-line');
		args.push(`${editor.selection.start.line + 1}`);
	}
	return args;
}

function getTabsCount(editor: vscode.TextEditor): number {
	const startline = editor.selection.start.line;
	const tabs = editor.document.lineAt(startline).text.match('^\t*');
	return tabs ? tabs.length : 0;
}

function execFillStruct(editor: vscode.TextEditor, args: string[]): Promise<void> {
	const fillstruct = getBinPath('fillstruct');
	const input = getFileArchive(editor.document);
	const tabsCount = getTabsCount(editor);

	return new Promise<void>((resolve, reject) => {
		const p = cp.execFile(fillstruct, args, { env: getToolsEnvVars() }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('fillstruct');
					return reject();
				}
				if (err) {
					vscode.window.showInformationMessage(`Cannot fill struct: ${stderr}`);
					return reject();
				}

				const output = <GoFillStructOutput[]>JSON.parse(stdout);

				if (output.length === 0) {
					vscode.window.showInformationMessage(`Got empty fillstruct output`);
					return reject();
				}

				const indent = '\t'.repeat(tabsCount);
				const offsetConverter = makeMemoizedByteOffsetConverter(Buffer.from(editor.document.getText()));

				editor
					.edit((editBuilder) => {
						output.forEach((structToFill) => {
							const out = structToFill.code.replace(/\n/g, '\n' + indent);
							const rangeToReplace = new vscode.Range(
								editor.document.positionAt(offsetConverter(structToFill.start)),
								editor.document.positionAt(offsetConverter(structToFill.end))
							);
							editBuilder.replace(rangeToReplace, out);
						});
					})
					.then(() => resolve());
			} catch (e) {
				reject(e);
			}
		});
		if (p.pid) {
			p.stdin.end(input);
		}
	});
}
