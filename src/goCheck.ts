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
import { getGoRuntimePath, resolvePath } from './goPath';
import { getCoverage } from './goCover';
import { outputChannel } from './goStatus';
import { promptForMissingTool } from './goInstallTools';
import { goTest } from './goTest';
import { getBinPath, parseFilePrelude, getCurrentGoWorkspaceFromGOPATH, getToolsEnvVars } from './util';
import { getNonVendorPackages } from './goPackages';

let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
statusBarItem.command = 'go.test.showOutput';

export function removeTestStatus(e: vscode.TextDocumentChangeEvent) {
	if (e.document.isUntitled) {
		return;
	}
	statusBarItem.hide();
	statusBarItem.text = '';
}

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
 * @param severity error or warning
 * @param useStdErr If true, the stderr of the output of the given tool will be used, else stdout will be used
 * @param toolName The name of the Go tool to run. If none is provided, the go runtime itself is used
 * @param printUnexpectedOutput If true, then output that doesnt match expected format is printed to the output channel
 */
function runTool(args: string[], cwd: string, severity: string, useStdErr: boolean, toolName: string, env: any, printUnexpectedOutput?: boolean): Promise<ICheckResult[]> {
	let goRuntimePath = getGoRuntimePath();
	let cmd = toolName ? getBinPath(toolName) : goRuntimePath;
	return new Promise((resolve, reject) => {
		cp.execFile(cmd, args, { env: env, cwd: cwd }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					// Since the tool is run on save which can be frequent
					// we avoid sending explicit notification if tool is missing
					console.log(`Cannot find ${toolName ? toolName : goRuntimePath}`);
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
					if (err) {
						ret.push({
							file: vscode.window.activeTextEditor.document.fileName,
							line: 1,
							msg: stderr,
							severity: 'error'
						});
					}
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
	let env = getToolsEnvVars();
	let goRuntimePath = getGoRuntimePath();

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve([]);
	}

	let testPromise: Thenable<boolean>;
	let tmpCoverPath;
	let runTest = () => {
		if (testPromise) {
			return testPromise;
		}

		let buildFlags = goConfig['testFlags'] || goConfig['buildFlags'] || [];

		let args = buildFlags;
		if (goConfig['coverOnSave']) {
			tmpCoverPath = path.normalize(path.join(os.tmpdir(), 'go-code-cover'));
			args = ['-coverprofile=' + tmpCoverPath, ...buildFlags];
		}

		testPromise = goTest({
			goConfig: goConfig,
			dir: cwd,
			flags: args,
			background: true
		});
		return testPromise;
	};

	if (!!goConfig['buildOnSave'] && goConfig['buildOnSave'] !== 'off') {
		const tmpPath = path.normalize(path.join(os.tmpdir(), 'go-code-check'));
		let buildFlags = goConfig['buildFlags'] || [];
		// Remove the -i flag as it will be added later anyway
		if (buildFlags.indexOf('-i') > -1) {
			buildFlags.splice(buildFlags.indexOf('-i'), 1);
		}

		// We use `go test` instead of `go build` because the latter ignores test files
		let buildArgs: string[] = ['test', '-i', '-c', '-o', tmpPath, ...buildFlags];
		if (goConfig['buildTags']) {
			buildArgs.push('-tags');
			buildArgs.push('"' + goConfig['buildTags'] + '"');
		}

		if (goConfig['buildOnSave'] === 'workspace') {
			let buildPromises = [];
			let outerBuildPromise = getNonVendorPackages(vscode.workspace.rootPath).then(pkgs => {
				buildPromises = pkgs.map(pkgPath => {
					return runTool(
						buildArgs.concat(pkgPath),
						cwd,
						'error',
						true,
						null,
						env,
						true
					);
				});
				return Promise.all(buildPromises).then((resultSets) => {
					return Promise.resolve([].concat.apply([], resultSets));
				});
			});
			runningToolsPromises.push(outerBuildPromise);
		} else {
			// Find the right importPath instead of directly using `.`. Fixes https://github.com/Microsoft/vscode-go/issues/846
			let currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(cwd);
			let importPath = currentGoWorkspace ? cwd.substr(currentGoWorkspace.length + 1) : '.';

			runningToolsPromises.push(runTool(
				buildArgs.concat(importPath),
				cwd,
				'error',
				true,
				null,
				env,
				true
			));
		}
	}

	if (!!goConfig['testOnSave']) {
		statusBarItem.show();
		statusBarItem.text = 'Tests Running';
		runTest().then(success => {
			if (statusBarItem.text === '') {
				return;
			}
			if (success) {
				statusBarItem.text = 'Tests Passed';
			} else {
				statusBarItem.text = 'Tests Failed';
			}
		});
	}

	if (!!goConfig['lintOnSave'] && goConfig['lintOnSave'] !== 'off') {
		let lintTool = goConfig['lintTool'] || 'golint';
		let lintFlags: string[] = goConfig['lintFlags'] || [];

		let args = [];
		let configFlag = '--config=';
		lintFlags.forEach(flag => {
			// --json is not a valid flag for golint and in gometalinter, it is used to print output in json which we dont want
			if (flag === '--json') {
				return;
			}
			if (flag.startsWith(configFlag)) {
				let configFilePath = flag.substr(configFlag.length);
				configFilePath = resolvePath(configFilePath, vscode.workspace.rootPath);
				args.push(`${configFlag}${configFilePath}`);
				return;
			}
			args.push(flag);
		});
		if (lintTool === 'gometalinter' && args.indexOf('--aggregate') === -1) {
			args.push('--aggregate');
		}

		let lintWorkDir = cwd;

		if (goConfig['lintOnSave'] === 'workspace') {
			args.push('./...');
			lintWorkDir = vscode.workspace.rootPath;
		}

		runningToolsPromises.push(runTool(
			args,
			lintWorkDir,
			'warning',
			false,
			lintTool,
			env
		));
	}

	if (!!goConfig['vetOnSave'] && goConfig['vetOnSave'] !== 'off') {
		let vetFlags = goConfig['vetFlags'] || [];
		let vetArgs = ['tool', 'vet', ...vetFlags, '.'];
		let vetWorkDir = cwd;

		if (goConfig['vetOnSave'] === 'workspace') {
			vetWorkDir = vscode.workspace.rootPath;
		}

		runningToolsPromises.push(runTool(
			vetArgs,
			vetWorkDir,
			'warning',
			true,
			null,
			env
		));
	}

	if (!!goConfig['coverOnSave']) {
		let coverPromise = runTest().then(success => {
			if (!success) {
				return [];
			}
			// FIXME: it's not obvious that tmpCoverPath comes from runTest()
			return getCoverage(tmpCoverPath);
		});
		runningToolsPromises.push(coverPromise);
	}

	return Promise.all(runningToolsPromises).then(resultSets => [].concat.apply([], resultSets));
}
