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
import { getGoVersion, SemVersion, isVendorSupported } from './util';

let updatesDeclinedTools: string[] = [];

function getTools(goVersion: SemVersion): { [key: string]: string } {
	let goConfig = vscode.workspace.getConfiguration('go');
	let tools: { [key: string]: string } = {
		'gocode': 'github.com/nsf/gocode',
		'gopkgs': 'github.com/tpng/gopkgs',
		'go-outline': 'github.com/lukehoban/go-outline',
		'go-symbols': 'github.com/newhook/go-symbols',
		'guru': 'golang.org/x/tools/cmd/guru',
		'gorename': 'golang.org/x/tools/cmd/gorename'
	};

	// Install the doc/def tool that was chosen by the user
	if (goConfig['docsTool'] === 'godoc') {
		tools['godef'] = 'github.com/rogpeppe/godef';
	} else if (goConfig['docsTool'] === 'gogetdoc') {
		tools['gogetdoc'] = 'github.com/zmb3/gogetdoc';
	}

	// Install the formattool that was chosen by the user
	if (goConfig['formatTool'] === 'goimports') {
		tools['goimports'] = 'golang.org/x/tools/cmd/goimports';
	} else if (goConfig['formatTool'] === 'goreturns') {
		tools['goreturns'] = 'sourcegraph.com/sqs/goreturns';
	}

	// golint and gotests are not supported in go1.5
	if (!goVersion || (goVersion.major > 1 || (goVersion.major === 1 && goVersion.minor > 5))) {
		tools['golint'] = 'github.com/golang/lint/golint';
		tools['gotests'] = 'github.com/cweill/gotests/...';
	}
	return tools;
}

export function installAllTools() {
	getGoVersion().then((goVersion) => installTools(goVersion));
}

export function promptForMissingTool(tool: string) {

	getGoVersion().then((goVersion) => {
		if (goVersion && goVersion.major === 1 && goVersion.minor < 6) {
			if (tool === 'golint') {
				vscode.window.showInformationMessage('golint no longer supports go1.5, update your settings to use gometalinter as go.lintTool and install gometalinter');
				return;
			}
			if (tool === 'gotests') {
				vscode.window.showInformationMessage('Generate unit tests feature is not supported as gotests tool needs go1.6 or higher.');
				return;
			}
		}

		vscode.window.showInformationMessage(`The "${tool}" command is not available.  Use "go get -v ${getTools(goVersion)[tool]}" to install.`, 'Install All', 'Install').then(selected => {
			if (selected === 'Install') {
				installTools(goVersion, [tool]);
			} else if (selected === 'Install All') {
				getMissingTools(goVersion).then((missing) => installTools(goVersion, missing));
				hideGoStatus();
			}
		});
	});
}

export function promptForUpdatingTool(tool: string) {
	// If user has declined to update, then don't prompt
	if (updatesDeclinedTools.indexOf(tool) > -1) {
		return;
	}
	getGoVersion().then((goVersion) => {
		vscode.window.showInformationMessage(`The Go extension is better with the latest version of "${tool}". Use "go get -u -v ${getTools(goVersion)[tool]}" to update`, 'Update').then(selected => {
			if (selected === 'Update') {
				installTools(goVersion, [tool]);
			} else {
				updatesDeclinedTools.push(tool);
			}
		});
	});
}

/**
 * Installs given array of missing tools. If no input is given, the all tools are installed
 *
 * @param string[] array of tool names to be installed
 */
function installTools(goVersion: SemVersion, missing?: string[]) {
	let tools = getTools(goVersion);
	let goRuntimePath = getGoRuntimePath();
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

	// http.proxy setting takes precedence over environment variables
	let httpProxy = vscode.workspace.getConfiguration('http').get('proxy');
	let env = process.env;
	if (httpProxy) {
		env = Object.assign({}, process.env, {
			http_proxy: httpProxy,
			HTTP_PROXY: httpProxy,
			https_proxy: httpProxy,
			HTTPS_PROXY: httpProxy,
		});
	}
	missing.reduce((res: Promise<string[]>, tool: string) => {
		return res.then(sofar => new Promise<string[]>((resolve, reject) => {
			cp.execFile(goRuntimePath, ['get', '-u', '-v', tools[tool]], { env }, (err, stdout, stderr) => {
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
	}
}

export function setupGoPathAndOfferToInstallTools() {
	updateGoPathGoRootFromConfig();
	isVendorSupported();

	getGoVersion().then(goVersion => {
		getMissingTools(goVersion).then(missing => {
			if (missing.length > 0) {
				showGoStatus('Analysis Tools Missing', 'go.promptforinstall', 'Not all Go tools are available on the GOPATH');
				vscode.commands.registerCommand('go.promptforinstall', () => {
					promptForInstall(goVersion, missing);
					hideGoStatus();
				});
			}
		});
	});


	function promptForInstall(goVersion: SemVersion, missing: string[]) {
		let item = {
			title: 'Install',
			command() {
				installTools(goVersion, missing);
			}
		};
		vscode.window.showInformationMessage('Some Go analysis tools are missing from your GOPATH.  Would you like to install them?', item).then(selection => {
			if (selection) {
				selection.command();
			}
		});
	}
}

function getMissingTools(goVersion: SemVersion): Promise<string[]> {
	let keys = Object.keys(getTools(goVersion));
	return Promise.all<string>(keys.map(tool => new Promise<string>((resolve, reject) => {
		let toolPath = getBinPath(tool);
		fs.exists(toolPath, exists => {
			resolve(exists ? null : tool);
		});
	}))).then(res => {
		let missing = res.filter(x => x != null);
		return missing;
	});
}







