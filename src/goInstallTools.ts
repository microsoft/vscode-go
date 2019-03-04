/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import fs = require('fs');
import path = require('path');
import cp = require('child_process');
import { showGoStatus, hideGoStatus, outputChannel } from './goStatus';
import { getBinPath, getToolsGopath, getGoVersion, SemVersion, isVendorSupported, getCurrentGoPath, resolvePath } from './util';
import { goLiveErrorsEnabled } from './goLiveErrors';

let updatesDeclinedTools: string[] = [];
let installsDeclinedTools: string[] = [];
const allToolsWithImportPaths: { [key: string]: string } = {
	'gocode': 'github.com/mdempsky/gocode',
	'gocode-gomod': 'github.com/stamblerre/gocode',
	'gopkgs': 'github.com/uudashr/gopkgs/cmd/gopkgs',
	'go-outline': 'github.com/ramya-rao-a/go-outline',
	'go-symbols': 'github.com/acroca/go-symbols',
	'guru': 'golang.org/x/tools/cmd/guru',
	'gorename': 'golang.org/x/tools/cmd/gorename',
	'gomodifytags': 'github.com/fatih/gomodifytags',
	'goplay': 'github.com/haya14busa/goplay/cmd/goplay',
	'impl': 'github.com/josharian/impl',
	'gotype-live': 'github.com/tylerb/gotype-live',
	'godef': 'github.com/rogpeppe/godef',
	'gogetdoc': 'github.com/zmb3/gogetdoc',
	'goimports': 'golang.org/x/tools/cmd/goimports',
	'goreturns': 'github.com/sqs/goreturns',
	'goformat': 'winterdrache.de/goformat/goformat',
	'golint': 'golang.org/x/lint/golint',
	'gotests': 'github.com/cweill/gotests/...',
	'gometalinter': 'github.com/alecthomas/gometalinter',
	'staticcheck': 'honnef.co/go/tools/...',
	'golangci-lint': 'github.com/golangci/golangci-lint/cmd/golangci-lint',
	'revive': 'github.com/mgechev/revive',
	'go-langserver': 'github.com/sourcegraph/go-langserver',
	'dlv': 'github.com/go-delve/delve/cmd/dlv',
	'fillstruct': 'github.com/davidrjenni/reftools/cmd/fillstruct',
	'godoctor': 'github.com/godoctor/godoctor',
};

function getToolImportPath(tool: string, goVersion: SemVersion) {
	if (tool === 'gocode' && goVersion && goVersion.major < 2 && goVersion.minor < 9) {
		return 'github.com/nsf/gocode';
	}
	return allToolsWithImportPaths[tool];
}

// Tools used explicitly by the basic features of the extension
const importantTools = [
	'gocode',
	'gocode-gomod',
	'gopkgs',
	'go-outline',
	'go-symbols',
	'guru',
	'gorename',
	'godef',
	'gogetdoc',
	'goreturns',
	'goimports',
	'golint',
	'gometalinter',
	'staticcheck',
	'golangci-lint',
	'revive',
	'dlv'
];

function getTools(goVersion: SemVersion): string[] {
	let goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
	let tools: string[] = [
		'gocode',
		'gopkgs',
		'go-outline',
		'go-symbols',
		'guru',
		'gorename'
	];

	// Check if the system supports dlv (e.g. is 64-bit)
	// There doesn't seem to be a good way to check if the mips and s390
	// families are 64-bit, so just try to install it and hope for the best
	if (process.arch.match(/^(arm64|mips|mipsel|ppc64|s390|s390x|x64)$/)) {
		tools.push('dlv');
	}

	// gocode-gomod needed in go 1.11 & higher
	if (!goVersion || (goVersion.major === 1 && goVersion.minor >= 11)) {
		tools.push('gocode-gomod');
	}

	// Install the doc/def tool that was chosen by the user
	if (goConfig['docsTool'] === 'godoc') {
		tools.push('godef');
	} else if (goConfig['docsTool'] === 'gogetdoc') {
		tools.push('gogetdoc');
	}

	// Install the formattool that was chosen by the user
	if (goConfig['formatTool'] === 'goimports') {
		tools.push('goimports');
	} else if (goConfig['formatTool'] === 'goformat') {
		tools.push('goformat');
	} else if (goConfig['formatTool'] === 'goreturns') {
		tools.push('goreturns');
	}

	// Install the linter that was chosen by the user
	if (goConfig['lintTool'] === 'golint'
		|| goConfig['lintTool'] === 'gometalinter'
		|| goConfig['lintTool'] === 'staticcheck'
		|| goConfig['lintTool'] === 'golangci-lint'
		|| goConfig['lintTool'] === 'revive') {
		tools.push(goConfig['lintTool']);
	}

	if (goConfig['useLanguageServer']) {
		tools.push('go-langserver');
	}

	if (goLiveErrorsEnabled()) {
		tools.push('gotype-live');
	}

	tools.push(
		'gotests',
		'gomodifytags',
		'impl',
		'fillstruct',
		'goplay',
		'godoctor'
	);

	return tools;
}

export function installAllTools(updateExistingToolsOnly: boolean = false) {
	const allToolsDescription: { [key: string]: string } = {
		'gocode': '\t\t(Auto-completion)',
		'gocode-gomod': '(Autocompletion, works with Modules)',
		'gopkgs': '\t\t(Auto-completion of unimported packages & Add Import feature)',
		'go-outline': '\t(Go to symbol in file)',
		'go-symbols': '\t(Go to symbol in workspace)',
		'guru': '\t\t(Find all references and Go to implementation of symbols)',
		'gorename': '\t(Rename symbols)',
		'gomodifytags': '(Modify tags on structs)',
		'goplay': '\t\t(The Go playground)',
		'impl': '\t\t(Stubs for interfaces)',
		'gotype-live': '\t(Show errors as you type)',
		'godef': '\t\t(Go to definition)',
		'gogetdoc': '\t(Go to definition & text shown on hover)',
		'goimports': '\t(Formatter)',
		'goreturns': '\t(Formatter)',
		'goformat': '\t(Formatter)',
		'golint': '\t\t(Linter)',
		'gotests': '\t\t(Generate unit tests)',
		'gometalinter': '\t(Linter)',
		'golangci-lint': '\t(Linter)',
		'revive': '\t\t(Linter)',
		'staticcheck': '\t(Linter)',
		'go-langserver': '(Language Server)',
		'dlv': '\t\t\t(Debugging)',
		'fillstruct': '\t\t(Fill structs with defaults)',
		'godoctor': '\t\t(Extract to functions and variables)'
	};

	getGoVersion().then((goVersion) => {
		const allTools = getTools(goVersion);
		if (updateExistingToolsOnly) {
			installTools(allTools.filter(tool => {
				const toolPath = getBinPath(tool);
				return toolPath && path.isAbsolute(toolPath);
			}), goVersion);
			return;
		}
		vscode.window.showQuickPick(allTools.map(x => `${x} ${allToolsDescription[x]}`), {
			canPickMany: true,
			placeHolder: 'Select the tool to install/update.'
		}).then(selectedTools => {
			if (!selectedTools) {
				return;
			}
			installTools(selectedTools.map(x => x.substr(0, x.indexOf(' '))), goVersion);
		});
	});
}

export function promptForMissingTool(tool: string) {
	// If user has declined to install, then don't prompt
	if (installsDeclinedTools.indexOf(tool) > -1) {
		return;
	}
	getGoVersion().then((goVersion) => {
		if (goVersion && goVersion.major === 1 && goVersion.minor < 9) {
			if (tool === 'golint') {
				vscode.window.showInformationMessage('golint no longer supports go1.8, update your settings to use gometalinter as go.lintTool and install gometalinter');
				return;
			}
			if (tool === 'gotests') {
				vscode.window.showInformationMessage('Generate unit tests feature is not supported as gotests tool needs go1.9 or higher.');
				return;
			}
		}

		const items = ['Install'];
		getMissingTools(goVersion).then(missing => {
			if (missing.indexOf(tool) === -1) {
				return;
			}
			missing = missing.filter(x => x === tool || importantTools.indexOf(x) > -1);
			if (missing.length > 1 && tool.indexOf('-gomod') === -1) {
				items.push('Install All');
			}

			let msg = `The "${tool}" command is not available.  Use "go get -v ${getToolImportPath(tool, goVersion)}" to install.`;
			if (tool === 'gocode-gomod') {
				msg = `To provide auto-completions when using Go modules, we are testing a fork(${getToolImportPath(tool, goVersion)}) of "gocode" and an updated version of "gopkgs". Please press the Install button to install them.`;
			}
			vscode.window.showInformationMessage(msg, ...items).then(selected => {
				if (selected === 'Install') {
					if (tool === 'gocode-gomod') {
						installTools(['gocode-gomod', 'gopkgs'], goVersion);
					} else {
						installTools([tool], goVersion);
					}

				} else if (selected === 'Install All') {
					installTools(missing, goVersion);
					hideGoStatus();
				} else {
					installsDeclinedTools.push(tool);
				}
			});
		});
	});
}

export function promptForUpdatingTool(tool: string) {
	// If user has declined to update, then don't prompt
	if (updatesDeclinedTools.indexOf(tool) > -1) {
		return;
	}
	getGoVersion().then((goVersion) => {
		vscode.window.showInformationMessage(`The Go extension is better with the latest version of "${tool}". Use "go get -u -v ${getToolImportPath(tool, goVersion)}" to update`, 'Update').then(selected => {
			if (selected === 'Update') {
				installTools([tool], goVersion);
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
export function installTools(missing: string[], goVersion: SemVersion) {
	let goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return;
	}
	if (!missing) {
		return;
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
		let paths = toolsGopath.split(path.delimiter);
		toolsGopath = paths[0];
		envForTools['GOPATH'] = toolsGopath;
	} else {
		vscode.window.showInformationMessage('Cannot install Go tools. Set either go.gopath or go.toolsGopath in settings.', 'Open User Settings', 'Open Workspace Settings').then(selected => {
			if (selected === 'Open User Settings') {
				vscode.commands.executeCommand('workbench.action.openGlobalSettings');
			} else if (selected === 'Open Workspace Settings') {
				vscode.commands.executeCommand('workbench.action.openWorkspaceSettings');
			}
		});
		return;
	}

	envForTools['GO111MODULE'] = 'off';

	outputChannel.show();
	outputChannel.clear();
	outputChannel.appendLine(`Installing ${missing.length} ${missing.length > 1 ? 'tools' : 'tool'} at ${toolsGopath}${path.sep}bin`);
	missing.forEach((missingTool, index, missing) => {
		outputChannel.appendLine('  ' + missingTool);
	});

	outputChannel.appendLine(''); // Blank line for spacing.

	missing.reduce((res: Promise<string[]>, tool: string) => {
		return res.then(sofar => new Promise<string[]>((resolve, reject) => {
			const callback = (err: Error, stdout: string, stderr: string) => {
				if (err) {
					outputChannel.appendLine('Installing ' + getToolImportPath(tool, goVersion) + ' FAILED');
					let failureReason = tool + ';;' + err + stdout.toString() + stderr.toString();
					resolve([...sofar, failureReason]);
				} else {
					outputChannel.appendLine('Installing ' + getToolImportPath(tool, goVersion) + ' SUCCEEDED');
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
			};

			let closeToolPromise = Promise.resolve(true);
			const toolBinPath = getBinPath(tool);
			if (path.isAbsolute(toolBinPath) && (tool === 'gocode' || tool === 'gocode-gomod')) {
				closeToolPromise = new Promise<boolean>((innerResolve) => {
					cp.execFile(toolBinPath, ['close'], {}, (err, stdout, stderr) => {
						if (stderr && stderr.indexOf('rpc: can\'t find service Server.') > -1) {
							outputChannel.appendLine('Installing gocode aborted as existing process cannot be closed. Please kill the running process for gocode and try again.');
							return innerResolve(false);
						}
						innerResolve(true);
					});
				});
			}

			closeToolPromise.then((success) => {
				if (!success) {
					resolve([...sofar, null]);
					return;
				}
				let args = ['get', '-u', '-v'];
				if (tool.endsWith('-gomod')) {
					args.push('-d');
				}
				args.push(getToolImportPath(tool, goVersion));
				cp.execFile(goRuntimePath, args, { env: envForTools }, (err, stdout, stderr) => {
					if (stderr.indexOf('unexpected directory layout:') > -1) {
						outputChannel.appendLine(`Installing ${tool} failed with error "unexpected directory layout". Retrying...`);
						cp.execFile(goRuntimePath, args, { env: envForTools }, callback);
					} else if (!err && tool.endsWith('-gomod')) {
						const outputFile = path.join(toolsGopath, 'bin', process.platform === 'win32' ? `${tool}.exe` : tool);
						cp.execFile(goRuntimePath, ['build', '-o', outputFile, getToolImportPath(tool, goVersion)], { env: envForTools }, callback);
					} else {
						callback(err, stdout, stderr);
					}
				});
			});
		}));
	}, Promise.resolve([])).then(res => {
		outputChannel.appendLine(''); // Blank line for spacing
		let failures = res.filter(x => x != null);
		if (failures.length === 0) {
			if (missing.indexOf('go-langserver') > -1) {
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
	let goroot = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null)['goroot'];
	if (goroot) {
		process.env['GOROOT'] = resolvePath(goroot);
	}

	if (process.env['GOPATH'] && process.env['GOROOT']) {
		return Promise.resolve();
	}

	// If GOPATH is still not set, then use the one from `go env`
	let goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		return Promise.reject(new Error('Cannot find "go" binary. Update PATH or GOROOT appropriately'));
	}
	return new Promise<void>((resolve, reject) => {
		cp.execFile(goRuntimePath, ['env', 'GOPATH', 'GOROOT'], (err, stdout, stderr) => {
			if (err) {
				return reject();
			}
			let envOutput = stdout.split('\n');
			if (!process.env['GOPATH'] && envOutput[0].trim()) {
				process.env['GOPATH'] = envOutput[0].trim();
			}
			if (!process.env['GOROOT'] && envOutput[1] && envOutput[1].trim()) {
				process.env['GOROOT'] = envOutput[1].trim();
			}
			return resolve();
		});
	});
}

export function offerToInstallTools() {
	isVendorSupported();

	getGoVersion().then(goVersion => {
		getMissingTools(goVersion).then(missing => {
			missing = missing.filter(x => importantTools.indexOf(x) > -1);
			if (missing.length > 0) {
				showGoStatus('Analysis Tools Missing', 'go.promptforinstall', 'Not all Go tools are available on the GOPATH');
				vscode.commands.registerCommand('go.promptforinstall', () => {
					promptForInstall(missing, goVersion);
				});
			}
		});
	});


	function promptForInstall(missing: string[], goVersion: SemVersion) {
		let installItem = {
			title: 'Install',
			command() {
				hideGoStatus();
				installTools(missing, goVersion);
			}
		};
		let showItem = {
			title: 'Show',
			command() {
				outputChannel.clear();
				outputChannel.appendLine('Below tools are needed for the basic features of the Go extension.');
				missing.forEach(x => outputChannel.appendLine(x));
			}
		};
		vscode.window.showInformationMessage('Some Go analysis tools are missing from your GOPATH.  Would you like to install them?', installItem, showItem).then(selection => {
			if (selection) {
				selection.command();
			} else {
				hideGoStatus();
			}
		});
	}
}

function getMissingTools(goVersion: SemVersion): Promise<string[]> {
	let keys = getTools(goVersion);
	return Promise.all<string>(keys.map(tool => new Promise<string>((resolve, reject) => {
		let toolPath = getBinPath(tool);
		fs.exists(toolPath, exists => {
			resolve(exists ? null : tool);
		});
	}))).then(res => {
		return res.filter(x => x != null);
	});
}

// If langserver needs to be used, but is not installed, this will prompt user to install and Reload
// If langserver needs to be used, and is installed, this will return true
// Returns false in all other cases
export function checkLanguageServer(): boolean {
	let latestGoConfig = vscode.workspace.getConfiguration('go');
	if (!latestGoConfig['useLanguageServer']) return false;

	if (!allFoldersHaveSameGopath()) {
		vscode.window.showInformationMessage('The Go language server is not supported in a multi root set up with different GOPATHs.');
		return false;
	}

	let langServerAvailable = getBinPath('go-langserver') !== 'go-langserver';
	if (!langServerAvailable) {
		promptForMissingTool('go-langserver');
		vscode.window.showInformationMessage('Reload VS Code window after installing the Go language server');
	}
	return langServerAvailable;
}

function allFoldersHaveSameGopath(): boolean {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length <= 1) {
		return true;
	}

	let tempGopath = getCurrentGoPath(vscode.workspace.workspaceFolders[0].uri);
	return vscode.workspace.workspaceFolders.find(x => tempGopath !== getCurrentGoPath(x.uri)) ? false : true;
}
