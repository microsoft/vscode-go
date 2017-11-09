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
import { getGoRuntimePath, getCurrentGoWorkspaceFromGOPATH } from './goPath';
import { getCoverage } from './goCover';
import { outputChannel } from './goStatus';
import { promptForMissingTool } from './goInstallTools';
import { goTest } from './testUtils';
import { getBinPath, parseFilePrelude, getCurrentGoPath, getToolsEnvVars, resolvePath, ICheckResult, runTool } from './util';
import { getNonVendorPackages } from './goPackages';
import { getTestFlags } from './testUtils';
import { goLint } from './goLint';

let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
statusBarItem.command = 'go.test.showOutput';

export function removeTestStatus(e: vscode.TextDocumentChangeEvent) {
	if (e.document.isUntitled) {
		return;
	}
	statusBarItem.hide();
	statusBarItem.text = '';
}

export function check(fileUri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration): Promise<ICheckResult[]> {
	outputChannel.clear();
	let runningToolsPromises = [];
	let cwd = path.dirname(fileUri.fsPath);
	let currentWorkspace = vscode.workspace.getWorkspaceFolder(fileUri) ? vscode.workspace.getWorkspaceFolder(fileUri).uri.fsPath : '';
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
		const isTestFile = fileUri.fsPath.endsWith('_test.go');
		let buildFlags = isTestFile ? getTestFlags(goConfig, null) : (goConfig['buildFlags'] || []);
		// Remove the -i flag as it will be added later anyway
		if (buildFlags.indexOf('-i') > -1) {
			buildFlags.splice(buildFlags.indexOf('-i'), 1);
		}

		// If current file is a test file, then use `go test -c` instead of `go build` to find build errors
		let buildArgs: string[] = isTestFile ? ['test', '-c'] : ['build'];
		buildArgs.push('-i', '-o', tmpPath, ...buildFlags);
		if (goConfig['buildTags'] && buildFlags.indexOf('-tags') === -1) {
			buildArgs.push('-tags');
			buildArgs.push('"' + goConfig['buildTags'] + '"');
		}

		if (goConfig['buildOnSave'] === 'workspace' && currentWorkspace && !isTestFile) {
			let buildPromises = [];
			let outerBuildPromise = getNonVendorPackages(currentWorkspace).then(pkgs => {
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
			let currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), cwd);
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
		let lintWorkspace = goConfig['lintOnSave'] === 'workspace';
		runningToolsPromises.push(goLint(fileUri, goConfig, lintWorkspace));
	}

	if (!!goConfig['vetOnSave'] && goConfig['vetOnSave'] !== 'off') {
		let vetFlags = goConfig['vetFlags'] || [];
		let vetArgs = vetFlags.length ? ['tool', 'vet', ...vetFlags, '.'] : ['vet', './...'];
		let vetWorkDir = (goConfig['vetOnSave'] === 'workspace' && currentWorkspace) ? currentWorkspace : cwd;

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
		runTest().then(success => {
			if (!success) {
				return [];
			}
			// FIXME: it's not obvious that tmpCoverPath comes from runTest()
			return getCoverage(tmpCoverPath);
		});
	}

	return Promise.all(runningToolsPromises).then(function (resultSets) {
		let results: ICheckResult[] = [].concat.apply([], resultSets);
		// Filter duplicates
		return results.filter((results, index, self) =>
			self.findIndex((t) => {
				return t.file === results.file && t.line === results.line && t.msg === results.msg && t.severity === results.severity;
			}) === index);
	});
}
