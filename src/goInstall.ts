'use strict';

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import util = require('util');
import { getGoRuntimePath } from './goPath'

export function goInstall(packages: string[]) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage("No editor is active.");
		return;
	}
	let channel = vscode.window.createOutputChannel('Go');
	channel.clear();
	channel.show(2);
	let args = ['install', '-v', packages.join(' ')];
	let proc = cp.spawn(getGoRuntimePath(), args, { env: process.env, cwd: vscode.workspace.rootPath });
	proc.stdout.on('data', chunk => channel.append(chunk.toString()));
	proc.stderr.on('data', chunk => channel.append(chunk.toString()));
	proc.on('close', code => {
		if (code) {
			channel.append("Error: Install failed.");
		} else {
			channel.append("Success: Install completed.");
		}
	});
}
