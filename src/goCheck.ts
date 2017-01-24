/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import os = require('os');
import fs = require('fs');
import { getGoRuntimePath } from './goPath';
import { getCoverage } from './goCover';
import { outputChannel } from './goStatus';
import { promptForMissingTool } from './goInstallTools';
import { getBinPath, parseFilePrelude } from './util';

export interface ICheckResult {
	file: string;
	line: number;
	msg: string;
	severity: string;
}

/**
 * Runs given Go tool and returns errors/warnings that can be fed to the Problems Matcher
 * @param args Arguments to be passed while running given tool
 * @param cwd cwd that will passed in the env object while running given tool
 * @param serverity error or warning
 * @param useStdErr If true, the stderr of the output of the given tool will be used, else stdout will be used
 * @param toolName The name of the Go tool to run. If none is provided, the go runtime itself is used
 * @param printUnexpectedOutput If true, then output that doesnt match expected format is printed to the output channel
 */
function runTool(args: string[], cwd: string, severity: string, useStdErr: boolean, toolName: string, printUnexpectedOutput?: boolean): Promise<ICheckResult[]> {
	let goRuntimePath = getGoRuntimePath();
	let cmd = toolName ? getBinPath(toolName) : goRuntimePath;
	return new Promise((resolve, reject) => {
		cp.execFile(cmd, args, { cwd: cwd }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					if (toolName) {
						promptForMissingTool(toolName);
					} else {
						vscode.window.showInformationMessage(`Cannot find ${goRuntimePath}`);
					}
					return resolve([]);
				}
				if (err && stderr && !useStdErr) {
					outputChannel.appendLine(['Error while running tool:', cmd, ...args].join(' '));
					outputChannel.appendLine(stderr);
					return resolve([]);
				}
				let lines = (useStdErr ? stderr : stdout).toString().split('\n');
				outputChannel.appendLine(['Finished running tool:', cmd, ...args].join(' '));

				let ret: ICheckResult[] = [];
				let unexpectedOutput = false;
				let atleastSingleMatch = false;
				for (let i = 0; i < lines.length; i++) {
					if (lines[i][0] === '\t' && ret.length > 0) {
						ret[ret.length - 1].msg += '\n' + lines[i];
						continue;
					}
					let match = /^([^:]*: )?((.:)?[^:]*):(\d+)(:(\d+)?)?:(?:\w+:)? (.*)$/.exec(lines[i]);
					if (!match) {
						if (printUnexpectedOutput && useStdErr && stderr) unexpectedOutput = true;
						continue;
					}
					atleastSingleMatch = true;
					let [_, __, file, ___, lineStr, ____, charStr, msg] = match;
					let line = +lineStr;
					file = path.resolve(cwd, file);
					ret.push({ file, line, msg, severity });
					outputChannel.appendLine(`${file}:${line}: ${msg}`);
				}
				if (!atleastSingleMatch && unexpectedOutput && vscode.window.activeTextEditor) {
					outputChannel.appendLine(stderr);
					ret.push({
						file: vscode.window.activeTextEditor.document.fileName,
						line: 1,
						msg: stderr,
						severity: 'error'
					});
				}
				outputChannel.appendLine('');
				resolve(ret);
			} catch (e) {
				reject(e);
			}
		});
	});
}

export function check(filename: string, goConfig: vscode.WorkspaceConfiguration): Promise<ICheckResult[]> {
	outputChannel.clear();
	let runningToolsPromises = [];
	let cwd = path.dirname(filename);
	let goRuntimePath = getGoRuntimePath();

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve([]);
	}

	if (!!goConfig['buildOnSave']) {
		// we need to parse the file to check the package name
		// if the package is a main pkg, we won't be doing a go build -i
		let buildPromise = new Promise<{}>((resolve, reject) => {
			let isMainPkg = false;
			fs.readFile(filename, 'utf8', (err, data) => {
				if (err) {
					return;
				}
				let prelude = parseFilePrelude(data);
				if (prelude.pkg) {
					isMainPkg = prelude.pkg.name === 'main';
				}

				let buildFlags = goConfig['buildFlags'] || [];
				let buildTags = '"' + goConfig['buildTags'] + '"';
				let tmppath = path.normalize(path.join(os.tmpdir(), 'go-code-check'));
				let args = ['build'];
				if (!isMainPkg) {
					args.push('-i');
				};
				args = args.concat(['-o', tmppath, '-tags', buildTags, ...buildFlags, '.']);
				if (filename.match(/_test.go$/i)) {
					args = ['test', '-copybinary', '-o', tmppath, '-c', '-tags', buildTags, ...buildFlags, '.'];
				}
				runTool(
					args,
					cwd,
					'error',
					true,
					null,
					true
				).then(result => resolve(result), err => reject(err));
			});
		});
		runningToolsPromises.push(buildPromise);
	}
	if (!!goConfig['lintOnSave']) {
		let lintTool = goConfig['lintTool'] || 'golint';
		let lintFlags = goConfig['lintFlags'] || [];
		let args = [...lintFlags];

		runningToolsPromises.push(runTool(
			args,
			cwd,
			'warning',
			false,
			lintTool
		));
	}

	if (!!goConfig['vetOnSave']) {
		let vetFlags = goConfig['vetFlags'] || [];
		runningToolsPromises.push(runTool(
			['tool', 'vet', ...vetFlags, filename],
			cwd,
			'warning',
			true,
			null
		));
	}

	if (!!goConfig['coverOnSave']) {
		runningToolsPromises.push(getCoverage(filename));
	}

	return Promise.all(runningToolsPromises).then(resultSets => [].concat.apply([], resultSets));
}
