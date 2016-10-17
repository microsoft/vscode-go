/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import fs = require('fs');
import path = require('path');
import os = require('os');
import cp = require('child_process');
import { showGoStatus, hideGoStatus } from './goStatus';
import { getBinPath, getGoRuntimePath } from './goPath';
import { outputChannel } from './goStatus';

interface SemVersion {
	major: number;
	minor: number;
}

let goVersion: SemVersion = null;

function getTools(): { [key: string]: string }  {
	let goConfig = vscode.workspace.getConfiguration('go');
	let tools: { [key: string]: string } = {
		'gocode': 'github.com/nsf/gocode',
		'gopkgs': 'github.com/tpng/gopkgs',
		'godef': 'github.com/rogpeppe/godef',
		'go-outline': 'github.com/lukehoban/go-outline',
		'go-symbols': 'github.com/newhook/go-symbols',
		'guru': 'golang.org/x/tools/cmd/guru',
		'gorename': 'golang.org/x/tools/cmd/gorename'
	};

	// Install the formattool that was chosen by the user
	if (goConfig['formatTool'] === 'goimports') {
		tools['goimports'] = 'golang.org/x/tools/cmd/goimports';
	} else if (goConfig['formatTool'] === 'goreturns') {
		tools['goreturns'] = 'sourcegraph.com/sqs/goreturns';
	}

	// golint is no longer supported in go1.5
	if (goVersion && (goVersion.major > 1 || (goVersion.major === 1 && goVersion.minor > 5))) {
		tools['golint'] = 'github.com/golang/lint/golint';
		tools['gotests'] = 'github.com/cweill/gotests/...';
	}
	return tools;
}

export function installAllTools() {
	getGoVersion().then(() => installTools());
}

export function promptForMissingTool(tool: string) {

	getGoVersion().then(() => {
		if (goVersion.major === 1 && goVersion.minor < 6) {
			if (tool === 'golint') {
				vscode.window.showInformationMessage('golint no longer supports go1.5, update your settings to use gometalinter as go.lintTool and install gometalinter');
				return;
			}
			if (tool === 'gotests') {
				vscode.window.showInformationMessage('Generate unit tests feature is not supported as gotests tool needs go1.6 or higher.');
				return;
			}
		}

		vscode.window.showInformationMessage(`The "${tool}" command is not available.  Use "go get -v ${getTools()[tool]}" to install.`, 'Install All', 'Install').then(selected => {
			if (selected === 'Install') {
				installTools([tool]);
			} else if (selected === 'Install All') {
				getMissingTools().then(installTools);
				hideGoStatus();
			}
		});
	});

}

/**
 * Installs given array of missing tools. If no input is given, the all tools are installed
 *
 * @param string[] array of tool names to be installed
 */
function installTools(missing?: string[]) {
	let tools = getTools();
	if (!missing) {
		missing = Object.keys(tools);
	}
	outputChannel.show();
	outputChannel.clear();
	outputChannel.appendLine('Installing ' + missing.length + ' tools');
	missing.forEach((missingTool, index, missing) => {
		outputChannel.appendLine('  ' + missingTool);
	});

	outputChannel.appendLine(''); // Blank line for spacing.

	missing.reduce((res: Promise<string[]>, tool: string) => {
		return res.then(sofar => new Promise<string[]>((resolve, reject) => {
			cp.exec('go get -u -v ' + tools[tool], { env: process.env }, (err, stdout, stderr) => {
				if (err) {
					outputChannel.appendLine('Installing ' + tool + ' FAILED');
					let failureReason = tool + ';;' + err + stdout.toString() + stderr.toString();
					resolve([...sofar, failureReason]);
				} else {
					outputChannel.appendLine('Installing ' + tool + ' SUCCEEDED');
					resolve([...sofar, null]);
				}
			});
		}));
	}, Promise.resolve([])).then(res => {
		outputChannel.appendLine(''); // Blank line for spacing
		let failures = res.filter(x => x != null);
		if (failures.length === 0) {
			outputChannel.appendLine('All tools successfully installed. You\'re ready to Go :).');
			return;
		}

		outputChannel.appendLine(failures.length + ' tools failed to install.\n');
		failures.forEach((failure, index, failures) => {
			let reason = failure.split(';;');
			outputChannel.appendLine(reason[0] + ':');
			outputChannel.appendLine(reason[1]);
		});
	});
}

export function updateGoPathGoRootFromConfig() {
	let goroot = vscode.workspace.getConfiguration('go')['goroot'];
	if (goroot) {
		process.env['GOROOT'] = goroot;
	}

	let gopath = vscode.workspace.getConfiguration('go')['gopath'];
	if (gopath) {
		process.env['GOPATH'] = gopath.replace(/\${workspaceRoot}/g, vscode.workspace.rootPath);
		hideGoStatus();
	}
}

export function setupGoPathAndOfferToInstallTools() {
	updateGoPathGoRootFromConfig();

	if (!process.env['GOPATH']) {
		let info = 'GOPATH is not set as an environment variable or via `go.gopath` setting in Code';
		showGoStatus('GOPATH not set', 'go.gopathinfo', info);
		vscode.commands.registerCommand('go.gopathinfo', () => {
			vscode.window.showInformationMessage(info);
			hideGoStatus();
		});
		return;
	}

	getMissingTools().then(missing => {
		if (missing.length > 0) {
			showGoStatus('Analysis Tools Missing', 'go.promptforinstall', 'Not all Go tools are available on the GOPATH');
			vscode.commands.registerCommand('go.promptforinstall', () => {
				promptForInstall(missing);
				hideGoStatus();
			});
		}
	});

	function promptForInstall(missing: string[]) {
		let item = {
			title: 'Install',
			command() {
				installTools(missing);
			}
		};
		vscode.window.showInformationMessage('Some Go analysis tools are missing from your GOPATH.  Would you like to install them?', item).then(selection => {
			if (selection) {
				selection.command();
			}
		});
	}
}

function getMissingTools(): Promise<string[]> {
	return getGoVersion().then(() => {
		let keys = Object.keys(getTools());
		return Promise.all<string>(keys.map(tool => new Promise<string>((resolve, reject) => {
			let toolPath = getBinPath(tool);
			fs.exists(toolPath, exists => {
				resolve(exists ? null : tool);
			});
		}))).then(res => {
			let missing = res.filter(x => x != null);
			return missing;
		});
	});
}

export function getGoVersion(): Promise<SemVersion> {
	let goRuntimePath = getGoRuntimePath();

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}

	if (goVersion) {
		return Promise.resolve(goVersion);
	}
	return new Promise<SemVersion>((resolve, reject) => {
		cp.execFile(goRuntimePath, ['version'], {}, (err, stdout, stderr) => {
			let matches = /go version go(\d).(\d).*/.exec(stdout);
			if (matches) {
				goVersion = {
					major: parseInt(matches[1]),
					minor: parseInt(matches[2])
				};
			}
			return resolve(goVersion);
		});
	});
}