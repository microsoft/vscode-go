/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import vscode = require('vscode');
import { promptForMissingTool } from './goInstallTools';
import { byteOffsetAt, getBinPath, getFileArchive, getGoConfig, getToolsEnvVars } from './util';

// Interface for the output from gomodifytags
interface GomodifytagsOutput {
	start: number;
	end: number;
	lines: string[];
}

// Interface for settings configuration for adding and removing tags
interface GoTagsConfig {
	[key: string]: any;
	tags: string;
	options: string;
	promptForTags: boolean;
}

export function addTags(commandArgs: GoTagsConfig) {
	const args = getCommonArgs();
	if (!args) {
		return;
	}

	getTagsAndOptions(<GoTagsConfig>getGoConfig()['addTags'], commandArgs).then(([tags, options, transformValue]) => {
		if (!tags && !options) {
			return;
		}
		if (tags) {
			args.push('--add-tags');
			args.push(tags);
		}
		if (options) {
			args.push('--add-options');
			args.push(options);
		}
		if (transformValue) {
			args.push('--transform');
			args.push(transformValue);
		}
		runGomodifytags(args);
	});
}

export function removeTags(commandArgs: GoTagsConfig) {
	const args = getCommonArgs();
	if (!args) {
		return;
	}

	getTagsAndOptions(<GoTagsConfig>getGoConfig()['removeTags'], commandArgs).then(([tags, options]) => {
		if (!tags && !options) {
			args.push('--clear-tags');
			args.push('--clear-options');
		}
		if (tags) {
			args.push('--remove-tags');
			args.push(tags);
		}
		if (options) {
			args.push('--remove-options');
			args.push(options);
		}
		runGomodifytags(args);
	});
}

function getCommonArgs(): string[] {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	if (!editor.document.fileName.endsWith('.go')) {
		vscode.window.showInformationMessage('Current file is not a Go file.');
		return;
	}
	const args = ['-modified', '-file', editor.document.fileName, '-format', 'json'];
	if (
		editor.selection.start.line === editor.selection.end.line &&
		editor.selection.start.character === editor.selection.end.character
	) {
		// Add tags to the whole struct
		const offset = byteOffsetAt(editor.document, editor.selection.start);
		args.push('-offset');
		args.push(offset.toString());
	} else if (editor.selection.start.line <= editor.selection.end.line) {
		// Add tags to selected lines
		args.push('-line');
		args.push(`${editor.selection.start.line + 1},${editor.selection.end.line + 1}`);
	}

	return args;
}

function getTagsAndOptions(config: GoTagsConfig, commandArgs: GoTagsConfig): Thenable<string[]> {
	const tags = commandArgs && commandArgs.hasOwnProperty('tags') ? commandArgs['tags'] : config['tags'];
	const options = commandArgs && commandArgs.hasOwnProperty('options') ? commandArgs['options'] : config['options'];
	const promptForTags =
		commandArgs && commandArgs.hasOwnProperty('promptForTags')
			? commandArgs['promptForTags']
			: config['promptForTags'];
	const transformValue: string =
		commandArgs && commandArgs.hasOwnProperty('transform') ? commandArgs['transform'] : config['transform'];

	if (!promptForTags) {
		return Promise.resolve([tags, options, transformValue]);
	}

	return vscode.window
		.showInputBox({
			value: tags,
			prompt: 'Enter comma separated tag names'
		})
		.then((inputTags) => {
			return vscode.window
				.showInputBox({
					value: options,
					prompt: 'Enter comma separated options'
				})
				.then((inputOptions) => {
					return [inputTags, inputOptions, transformValue];
				});
		});
}

function runGomodifytags(args: string[]) {
	const gomodifytags = getBinPath('gomodifytags');
	const editor = vscode.window.activeTextEditor;
	const input = getFileArchive(editor.document);
	const p = cp.execFile(gomodifytags, args, { env: getToolsEnvVars() }, (err, stdout, stderr) => {
		if (err && (<any>err).code === 'ENOENT') {
			promptForMissingTool('gomodifytags');
			return;
		}
		if (err) {
			vscode.window.showInformationMessage(`Cannot modify tags: ${stderr}`);
			return;
		}
		const output = <GomodifytagsOutput>JSON.parse(stdout);
		vscode.window.activeTextEditor.edit((editBuilder) => {
			editBuilder.replace(new vscode.Range(output.start - 1, 0, output.end, 0), output.lines.join('\n') + '\n');
		});
	});
	if (p.pid) {
		p.stdin.end(input);
	}
}
