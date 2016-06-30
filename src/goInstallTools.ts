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
	gorename: 'golang.org/x/tools/cmd/gorename',
	gopkgs: 'github.com/tpng/gopkgs',
	gocode: 'github.com/nsf/gocode',
	goreturns: 'sourcegraph.com/sqs/goreturns',
	godef: 'github.com/rogpeppe/godef',
	golint: 'github.com/golang/lint/golint',
	'go-outline': 'github.com/lukehoban/go-outline',
	'go-symbols': 'github.com/newhook/go-symbols',
	guru: 'golang.org/x/tools/cmd/guru',
	godoctor: 'github.com/godoctor/godoctor'
};

export function installTool(tool: string) {
	outputChannel.clear();
	outputChannel.show();
	cp.exec('go get -u -v ' + tools[tool], { env: process.env }, (err, stdout, stderr) => {
		outputChannel.append(stdout.toString());
		outputChannel.append(stderr.toString());
		if (err) {
			outputChannel.append('exec error: ' + err);
		}
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

	let keys = Object.keys(tools);
	Promise.all(keys.map(tool => new Promise<string>((resolve, reject) => {
		let toolPath = getBinPath(tool);
		fs.exists(toolPath, exists => {
			resolve(exists ? null : tool);
		});
	}))).then(res => {
		let missing = res.filter(x => x != null);
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
				missing.forEach(installTool);
			}
		};
		vscode.window.showInformationMessage('Some Go analysis tools are missing from your GOPATH.  Would you like to install them?', item).then(selection => {
			if (selection) {
				selection.command();
			}
		});
	}
}
