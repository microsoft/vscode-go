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
import { getGoRuntimePath, resolvePath } from './goPath';
import { outputChannel } from './goStatus';
import { getBinPath, getToolsGopath, getGoVersion, SemVersion, isVendorSupported, getCurrentGoPath } from './util';
import { goLiveErrorsEnabled } from './goLiveErrors';

let updatesDeclinedTools: string[] = [];
let installsDeclinedTools: string[] = [];

function getTools(goVersion: SemVersion): { [key: string]: string } {
	let goConfig = vscode.workspace.getConfiguration('go');
	let tools: { [key: string]: string } = {
		'gocode': 'github.com/nsf/gocode',
		'gopkgs': 'github.com/uudashr/gopkgs/cmd/gopkgs',
		'go-outline': 'github.com/ramya-rao-a/go-outline',
		'go-symbols': 'github.com/acroca/go-symbols',
		'guru': 'golang.org/x/tools/cmd/guru',
		'gorename': 'golang.org/x/tools/cmd/gorename',
		'gomodifytags': 'github.com/fatih/gomodifytags',
		'impl': 'github.com/josharian/impl'
	};
	if (goLiveErrorsEnabled()) {
		tools['gotype-live'] = 'github.com/tylerb/gotype-live';
	}

	// Install the doc/def tool that was chosen by the user
	if (goConfig['docsTool'] === 'godoc') {
		tools['godef'] = 'github.com/rogpeppe/godef';
		tools['godoc'] = 'golang.org/x/tools/cmd/godoc';
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

	if (goConfig['lintTool'] === 'gometalinter') {
		tools['gometalinter'] = 'github.com/alecthomas/gometalinter';
	}

	if (goConfig['lintTool'] === 'megacheck') {
		tools['megacheck'] = 'honnef.co/go/tools/...';
	}

	if (goConfig['useLanguageServer'] && process.platform !== 'win32') {
		tools['go-langserver'] = 'github.com/sourcegraph/go-langserver';
	}

	if (process.platform !== 'darwin') {
		tools['dlv'] = 'github.com/derekparker/delve/cmd/dlv';
	}
	return tools;
}

export function installAllTools() {
	getGoVersion().then((goVersion) => installTools(goVersion));
}

export function promptForMissingTool(tool: string) {
	// If user has declined to install, then don't prompt
	if (installsDeclinedTools.indexOf(tool) > -1) {
		return;
	}
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

		vscode.window.showInformationMessage(`The "${tool}" command is not available.  Use "go get -v ${getTools(goVersion)[tool]}" to install.`, 'Install', 'Install All').then(selected => {
			if (selected === 'Install') {
				installTools(goVersion, [tool]);
			} else if (selected === 'Install All') {
				getMissingTools(goVersion).then((missing) => installTools(goVersion, missing));
				hideGoStatus();
			} else {
				installsDeclinedTools.push(tool);
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
	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return;
	}
	if (!missing) {
		missing = Object.keys(tools);
	}

	// http.proxy setting takes precedence over environment variables
	let httpProxy = vscode.workspace.getConfiguration('http').get('proxy');
	let envForTools = Object.assign({}, process.env);
	if (httpProxy) {
		envForTools = Object.assign({}, process.env, {
			http_proxy: httpProxy,
			HTTP_PROXY: httpProxy,
			https_proxy: httpProxy,
			HTTPS_PROXY: httpProxy,
		});
	}

	// If the go.toolsGopath is set, use its value as the GOPATH for the "go get" child process.
	// Else use the Current Gopath
	let toolsGopath = getToolsGopath() || getCurrentGoPath();
	if (toolsGopath) {
		envForTools['GOPATH'] = toolsGopath;
	} else {
		vscode.window.showInformationMessage('Cannot install Go tools. Set either go.gopath or go.toolsGopath in settings.', 'Open User settings', 'Open Workspace Settings').then(selected => {
			if (selected === 'Open User settings') {
				vscode.commands.executeCommand('workbench.action.openGlobalSettings');
			} else if (selected === 'Open User settings') {
				vscode.commands.executeCommand('workbench.action.openWorkspaceSettings');
			}
		});
		return;
	}

	outputChannel.show();
	outputChannel.clear();
	outputChannel.appendLine(`Installing ${missing.length} ${missing.length > 1 ? 'tools' : 'tool'} at ${toolsGopath}${path.sep}bin`);
	missing.forEach((missingTool, index, missing) => {
		outputChannel.appendLine('  ' + missingTool);
	});

	outputChannel.appendLine(''); // Blank line for spacing.

	missing.reduce((res: Promise<string[]>, tool: string) => {
		return res.then(sofar => new Promise<string[]>((resolve, reject) => {
			cp.execFile(goRuntimePath, ['get', '-u', '-v', tools[tool]], { env: envForTools }, (err, stdout, stderr) => {
				if (err) {
					outputChannel.appendLine('Installing ' + tools[tool] + ' FAILED');
					let failureReason = tool + ';;' + err + stdout.toString() + stderr.toString();
					resolve([...sofar, failureReason]);
				} else {
					outputChannel.appendLine('Installing ' + tools[tool] + ' SUCCEEDED');
					if (tool === 'gometalinter') {
						// Gometalinter needs to install all the linters it uses.
						outputChannel.appendLine('Installing all linters used by gometalinter....');
						let gometalinterBinPath = getBinPath('gometalinter');
						cp.execFile(gometalinterBinPath, ['--install'], { env: envForTools }, (err, stdout, stderr) => {
							if (!err) {
								outputChannel.appendLine('Installing all linters used by gometalinter SUCCEEDED.');
								resolve([...sofar, null]);
							} else {
								let failureReason = `Error while running gometalinter --install;; ${stderr}`;
								resolve([...sofar, failureReason]);
							}
						});
					} else {
						resolve([...sofar, null]);
					}
				}
			});
		}));
	}, Promise.resolve([])).then(res => {
		outputChannel.appendLine(''); // Blank line for spacing
		let failures = res.filter(x => x != null);
		if (failures.length === 0) {
			if (missing.indexOf('langserver-go') > -1) {
				outputChannel.appendLine('Reload VS Code window to use the Go language server');
			}
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

export function updateGoPathGoRootFromConfig(): Promise<void> {
	let goroot = vscode.workspace.getConfiguration('go')['goroot'];
	if (goroot) {
		process.env['GOROOT'] = goroot;
	}

	if (process.env['GOPATH']) {
		return Promise.resolve();
	}

	// If GOPATH is still not set, then use the one from `go env`
	let goRuntimePath = getGoRuntimePath();
	return new Promise<void>((resolve, reject) => {
		cp.execFile(goRuntimePath, ['env', 'GOPATH'], (err, stdout, stderr) => {
			if (err) {
				return reject();
			}
			let envOutput = stdout.split('\n');
			if (!process.env['GOPATH'] && envOutput[0].trim()) {
				process.env['GOPATH'] = envOutput[0].trim();
			}
			return resolve();
		});
	});
}

export function offerToInstallTools() {
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

function gopkgsMissing(): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		const cmd = cp.spawn(getBinPath('gopkgs'), ['-help']);
		cmd.stdout.on('data', (d) => {
			resolve(true);
		});

		cmd.stderr.on('data', (d) => {
			// expect the correct gopkgs, scan the output of the usage
			const lines = d.toString().split('\n').filter((line) => (line.indexOf('Usage of gopkgs') > -1) || (line.indexOf('output format of the package') > -1) || (line.indexOf('Use -f to custom') > -1));
			resolve(lines.length !== 3);
		});

		cmd.on('error', (err) => {
			if ((<any>err).code === 'ENOENT') {
				return resolve(true);
			}
			reject(err);
		});
	});
}

function getMissingTools(goVersion: SemVersion): Promise<string[]> {
	let keys = Object.keys(getTools(goVersion));
	return Promise.all<string>(keys.map(tool => new Promise<string>((resolve, reject) => {
		if (tool === 'gopkgs') {
			gopkgsMissing().then((missing) => {
				resolve(missing ? tool : null);
			});
			return;
		}

		let toolPath = getBinPath(tool);
		fs.exists(toolPath, exists => {
			resolve(exists ? null : tool);
		});
	}))).then(res => {
		let missing = res.filter(x => x != null);
		return missing;
	});
}

// If langserver needs to be used, but is not installed, this will prompt user to install and Reload
// If langserver needs to be used, and is installed, this will return true
// Returns false in all other cases
export function checkLanguageServer(): boolean {
	if (process.platform === 'win32') return false;
	let latestGoConfig = vscode.workspace.getConfiguration('go');
	if (!latestGoConfig['useLanguageServer']) return false;

	let langServerAvailable = getBinPath('go-langserver') !== 'go-langserver';
	if (!langServerAvailable) {
		promptForMissingTool('go-langserver');
		vscode.window.showInformationMessage('Reload VS Code window after installing the Go language server');
	}
	return langServerAvailable;
}





