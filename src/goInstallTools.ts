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
import { getBinPath } from './goPath';
import { outputChannel } from './goStatus';

let tools: { [key: string]: string } = {
	'gocode': 'github.com/nsf/gocode',
	'goreturns': 'sourcegraph.com/sqs/goreturns',
	'gopkgs': 'github.com/tpng/gopkgs',
	'godef': 'github.com/rogpeppe/godef',
	'golint': 'github.com/golang/lint/golint',
	'go-outline': 'github.com/lukehoban/go-outline',
	'go-symbols': 'github.com/newhook/go-symbols',
	'guru': 'golang.org/x/tools/cmd/guru',
	'gorename': 'golang.org/x/tools/cmd/gorename'
};

export function installAllTools() {
	installTools(Object.keys(tools));
}

export function promptForMissingTool(tool: string) {
	vscode.window.showInformationMessage(`The "${tool}" command is not available.  Use "go get -v ${tools[tool]}" to install.`, 'Install All', 'Install').then(selected => {
		if (selected === 'Install') {
			installTools([tool]);
		} else if (selected === 'Install All') {
			getMissingTools().then(installTools);
			hideGoStatus();
		}
	});
}

export function installTools(missing: string[]) {
	outputChannel.show();
	outputChannel.clear();
	outputChannel.appendLine('Installing ' + missing.length + ' missing tools');
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

export function setupGoPathAndOfferToInstallTools() {
	let goroot = vscode.workspace.getConfiguration('go')['goroot'];
	if (goroot) {
		process.env['GOROOT'] = goroot;
	}

	let gopath = vscode.workspace.getConfiguration('go')['gopath'];
	if (gopath) {
		process.env['GOPATH'] = gopath.replace(/\${workspaceRoot}/g, vscode.workspace.rootPath);
	}

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
	let keys = Object.keys(tools);
	return Promise.all(keys.map(tool => new Promise<string>((resolve, reject) => {
		let toolPath = getBinPath(tool);
		fs.exists(toolPath, exists => {
			resolve(exists ? null : tool);
		});
	}))).then(res => {
		let missing = res.filter(x => x != null);
		return missing;
	});
}
