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
import { getBinPath, getGoRuntimePath } from './goPath';
import { getCoverage } from './goCover';

export interface ICheckResult {
	file: string;
	line: number;
	msg: string;
	severity: string;
}

function runTool(cmd: string, args: string[], cwd: string, severity: string, useStdErr: boolean, notFoundError: string) {
	return new Promise((resolve, reject) => {
		cp.execFile(cmd, args, { cwd: cwd }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					vscode.window.showInformationMessage(notFoundError);
					return resolve([]);
				}
				let lines = (useStdErr ? stderr : stdout).toString().split('\n');
				let ret: ICheckResult[] = [];
				for (let i = 0; i < lines.length; i++) {
					if (lines[i][0] === '\t' && ret.length > 0) {
						ret[ret.length - 1].msg += '\n' + lines[i];
						continue;
					}
					let match = /^([^:]*: )?((.:)?[^:]*):(\d+)(:(\d+))?: (.*)$/.exec(lines[i]);
					if (!match) continue;
					let [_, __, file, ___, lineStr, ____, charStr, msg] = match;
					let line = +lineStr;
					ret.push({ file: path.resolve(cwd, file), line, msg, severity });
				}
				resolve(ret);
			} catch (e) {
				reject(e);
			}
		});
	});
}

export function check(filename: string, goConfig: vscode.WorkspaceConfiguration): Promise<ICheckResult[]> {
	let runningToolsPromises = [];
	let cwd = path.dirname(filename);

	if (!!goConfig['buildOnSave']) {
		let buildFlags = goConfig['buildFlags'] || [];
		let tmppath = path.normalize(path.join(os.tmpdir(), 'go-code-check'));
		let args = ['build', '-o', tmppath, ...buildFlags, '.'];
		if (filename.match(/_test.go$/i)) {
			args = ['test', '-copybinary', '-o', tmppath, '-c', ...buildFlags, '.'];
		}
		runningToolsPromises.push(runTool(
			getGoRuntimePath(),
			args,
			cwd,
			'error',
			true,
			'No "go" binary could be found in GOROOT: ' + process.env['GOROOT'] + '"'
		));
	}
	if (!!goConfig['lintOnSave']) {
		let golint = getBinPath('golint');
		let lintFlags = goConfig['lintFlags'] || [];
		runningToolsPromises.push(runTool(
			golint,
			[...lintFlags, filename],
			cwd,
			'warning',
			false,
			'The "golint" command is not available.  Use "go get -u github.com/golang/lint/golint" to install.'
		));
	}

	if (!!goConfig['vetOnSave']) {
		let vetFlags = goConfig['vetFlags'] || [];
		runningToolsPromises.push(runTool(
			getGoRuntimePath(),
			['tool', 'vet', ...vetFlags, filename],
			cwd,
			'warning',
			true,
			'No "go" binary could be found in GOROOT: "' + process.env['GOROOT'] + '"'
		));
	}

	if (!!goConfig['coverOnSave']) {
		runningToolsPromises.push(getCoverage(filename));
	}

	return Promise.all(runningToolsPromises).then(resultSets => [].concat.apply([], resultSets));
}