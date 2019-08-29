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
import { getToolFromToolPath, envPath } from './goPath';
import { getLanguageServerToolPath } from './goLanguageServer';
import { Tool, getConfiguredTools, getTool, isWildcard, isGocode, hasModSuffix, containsString, containsTool, getImportPath } from './goTools';
import { getGoVersion, getBinPath, SemVersion, getToolsGopath, getCurrentGoPath, isBelow, getTempFilePath, resolvePath } from './util';

// declinedUpdates tracks the tools that the user has declined to update.
const declinedUpdates: Tool[] = [];

// declinedUpdates tracks the tools that the user has declined to install.
const declinedInstalls: Tool[] = [];

export function installAllTools(updateExistingToolsOnly: boolean = false) {
	getGoVersion().then((goVersion) => {
		const allTools = getConfiguredTools(goVersion);

		// Update existing tools by finding all tools the user has already installed.
		if (updateExistingToolsOnly) {
			installTools(allTools.filter(tool => {
				const toolPath = getBinPath(tool.name);
				return toolPath && path.isAbsolute(toolPath);
			}), goVersion);
			return;
		}

		// Otherwise, allow the user to select which tools to install or update.
		vscode.window.showQuickPick(allTools.map(x => {
			// This doesn't correctly align the descriptions.
			// TODO: Fix.
			return `${x.name}: ${x.description}`;
		}), {
				canPickMany: true,
				placeHolder: 'Select the tool to install/update.'
			}).then(selectedTools => {
				if (!selectedTools) {
					return;
				}
				// TODO: This feels really hacky. Is there really not a better way to do this?
				installTools(selectedTools.map(x => getTool(x.substr(0, x.indexOf(': ')))), goVersion);
			});
	});
}

/**
 * Installs given array of missing tools. If no input is given, the all tools are installed
 *
 * @param string[] array of tool names to be installed
 */
export function installTools(missing: Tool[], goVersion: SemVersion): Promise<void> {
	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		vscode.window.showErrorMessage(`Failed to run "go get" to install the packages as the "go" binary cannot be found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`);
		return;
	}
	if (!missing) {
		return;
	}

	// http.proxy setting takes precedence over environment variables
	const httpProxy = vscode.workspace.getConfiguration('http').get('proxy');
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
	let toolsGopath = getToolsGopath();
	if (toolsGopath) {
		// User has explicitly chosen to use toolsGopath, so ignore GOBIN
		envForTools['GOBIN'] = '';
	} else {
		toolsGopath = getCurrentGoPath();
	}
	if (toolsGopath) {
		const paths = toolsGopath.split(path.delimiter);
		toolsGopath = paths[0];
		envForTools['GOPATH'] = toolsGopath;
	} else {
		const msg = 'Cannot install Go tools. Set either go.gopath or go.toolsGopath in settings.';
		vscode.window.showInformationMessage(msg, 'Open User Settings', 'Open Workspace Settings').then(selected => {
			switch (selected) {
				case 'Open User Settings':
					vscode.commands.executeCommand('workbench.action.openGlobalSettings');
					break;
				case 'Open Workspace Settings':
					vscode.commands.executeCommand('workbench.action.openWorkspaceSettings');
					break;
			}
		});
		return;
	}

	// If the user is on Go >= 1.11, tools should be installed with modules enabled.
	// This ensures that users get the latest tagged version, rather than master,
	// which may be unstable.
	let modulesOff = false;
	if (isBelow(goVersion, 1, 11)) {
		modulesOff = true;
	}

	outputChannel.show();
	outputChannel.clear();
	outputChannel.appendLine(`Installing ${missing.length} ${missing.length > 1 ? 'tools' : 'tool'} at ${toolsGopath}${path.sep}bin`);
	missing.forEach((missingTool, index, missing) => {
		outputChannel.appendLine('  ' + missingTool.name);
	});

	outputChannel.appendLine(''); // Blank line for spacing.

	// Install tools in a temporary directory, to avoid altering go.mod files.
	const toolsTmpDir = getTempFilePath('go-tools');
	if (!fs.existsSync(toolsTmpDir)) {
		fs.mkdirSync(toolsTmpDir);
	}

	return missing.reduce((res: Promise<string[]>, tool: Tool) => {
		// Disable modules for staticcheck and gotests,
		// which are installed with the "..." wildcard.
		// TODO: ... will be supported in Go 1.13, so enable these tools to use modules then.
		if (modulesOff || isWildcard(tool, goVersion)) {
			envForTools['GO111MODULE'] = 'off';
		} else {
			envForTools['GO111MODULE'] = 'on';
		}

		return res.then(sofar => new Promise<string[]>((resolve, reject) => {
			const callback = (err: Error, stdout: string, stderr: string) => {
				if (err) {
					outputChannel.appendLine('Installing ' + getImportPath(tool, goVersion) + ' FAILED');
					const failureReason = tool + ';;' + err + stdout.toString() + stderr.toString();
					resolve([...sofar, failureReason]);
				} else {
					outputChannel.appendLine('Installing ' + getImportPath(tool, goVersion) + ' SUCCEEDED');
					if (tool.name === 'gometalinter') {
						// Gometalinter needs to install all the linters it uses.
						outputChannel.appendLine('Installing all linters used by gometalinter....');
						const gometalinterBinPath = getBinPath('gometalinter');
						cp.execFile(gometalinterBinPath, ['--install'], { env: envForTools }, (err, stdout, stderr) => {
							if (!err) {
								outputChannel.appendLine('Installing all linters used by gometalinter SUCCEEDED.');
								resolve([...sofar, null]);
							} else {
								const failureReason = `Error while running gometalinter --install;; ${stderr}`;
								resolve([...sofar, failureReason]);
							}
						});
					} else {
						resolve([...sofar, null]);
					}
				}
			};

			let closeToolPromise = Promise.resolve(true);
			const toolBinPath = getBinPath(tool.name);
			if (path.isAbsolute(toolBinPath) && isGocode(tool)) {
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
				const args = ['get', '-v'];
				// Only get tools at master if we are not using modules.
				if (modulesOff) {
					args.push('-u');
				}
				// Tools with a "mod" suffix should not be installed,
				// instead we run "go build -o" to rename them.
				if (hasModSuffix(tool)) {
					args.push('-d');
				}
				const opts = {
					env: envForTools,
					cwd: toolsTmpDir,
				};
				args.push(getImportPath(tool, goVersion));
				cp.execFile(goRuntimePath, args, opts, (err, stdout, stderr) => {
					if (stderr.indexOf('unexpected directory layout:') > -1) {
						outputChannel.appendLine(`Installing ${tool.name} failed with error "unexpected directory layout". Retrying...`);
						cp.execFile(goRuntimePath, args, opts, callback);
					} else if (!err && hasModSuffix(tool)) {
						const outputFile = path.join(toolsGopath, 'bin', process.platform === 'win32' ? `${tool.name}.exe` : tool.name);
						cp.execFile(goRuntimePath, ['build', '-o', outputFile, getImportPath(tool, goVersion)], opts, callback);
					} else {
						callback(err, stdout, stderr);
					}
				});
			});
		}));
	}, Promise.resolve([])).then(res => {
		outputChannel.appendLine(''); // Blank line for spacing
		const failures = res.filter(x => x != null);
		if (failures.length === 0) {
			if (containsString(missing, 'go-langserver') || containsString(missing, 'gopls')) {
				outputChannel.appendLine('Reload VS Code window to use the Go language server');
			}
			outputChannel.appendLine('All tools successfully installed. You\'re ready to Go :).');
			return;
		}

		outputChannel.appendLine(failures.length + ' tools failed to install.\n');
		failures.forEach((failure, index, failures) => {
			const reason = failure.split(';;');
			outputChannel.appendLine(reason[0] + ':');
			outputChannel.appendLine(reason[1]);
		});
	});
}

export function promptForMissingTool(toolName: string) {
	const tool = getTool(toolName);

	// If user has declined to install this tool, don't prompt for it.
	if (containsTool(declinedInstalls, tool)) {
		return;
	}
	getGoVersion().then(goVersion => {
		// Show error messages for outdated tools.
		if (isBelow(goVersion, 1, 9)) {
			switch (tool.name) {
				case 'golint':
					vscode.window.showInformationMessage('golint no longer supports go1.8, update your settings to use gometalinter as go.lintTool and install gometalinter');
					return;
				case 'gotests':
					vscode.window.showInformationMessage('Generate unit tests feature is not supported as gotests tool needs go1.9 or higher.');
					return;
			}
		}

		const installOptions = ['Install'];
		getMissingTools(goVersion).then(missing => {
			if (!containsTool(missing, tool)) {
				return;
			}
			missing = missing.filter(x => x === tool || tool.isImportant);
			if (missing.length > 1 && hasModSuffix(tool)) {
				// Offer the option to install all tools.
				installOptions.push('Install All');
			}
			let msg = `The "${tool.name}" command is not available. Run "go get -v ${getImportPath(tool, goVersion)}" to install.`;
			if (tool.name === 'gocode-gomod') {
				msg = `To provide auto-completions when using Go modules, we are testing a fork(${getImportPath(tool, goVersion)}) of "gocode" and an updated version of "gopkgs". Please press the Install button to install them.`;
			}
			vscode.window.showInformationMessage(msg, ...installOptions).then(selected => {
				switch (selected) {
					case 'Install':
						// If we are installing module-aware gocode, also install gopkgs.
						if (tool.name === 'gocode-gomod') {
							installTools([tool, getTool('gopkgs')], goVersion);
						} else {
							installTools([tool], goVersion);
						}
						break;
					case 'Install All':
						installTools(missing, goVersion);
						hideGoStatus();
						break;
					default:
						// The user has declined to install this tool.
						declinedInstalls.push(tool);
						break;
				}
			});
		});
	});
}

export function promptForUpdatingTool(toolName: string) {
	const tool = getTool(toolName);

	// If user has declined to update, then don't prompt.
	if (containsTool(declinedUpdates, tool)) {
		return;
	}
	getGoVersion().then((goVersion) => {
		const updateMsg = `Your version of ${tool.name} appears to be out of date. Please update for an improved experience.`;
		vscode.window.showInformationMessage(updateMsg, 'Update').then(selected => {
			switch (selected) {
				case 'Update':
					installTools([tool], goVersion);
					break;
				default:
					declinedUpdates.push(tool);
					break;
			}
		});
	});
}

export function updateGoPathGoRootFromConfig(): Promise<void> {
	const goroot = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null)['goroot'];
	if (goroot) {
		process.env['GOROOT'] = resolvePath(goroot);
	}

	if (process.env['GOPATH'] && process.env['GOROOT']) {
		return Promise.resolve();
	}

	// If GOPATH is still not set, then use the one from `go env`
	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		vscode.window.showErrorMessage(`Failed to run "go env" to find GOPATH as the "go" binary cannot be found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`);
		return;
	}
	const goRuntimeBasePath = path.dirname(goRuntimePath);

	// cgo and a few other Go tools expect Go binary to be in the path
	let pathEnvVar: string;
	if (process.env.hasOwnProperty('PATH')) {
		pathEnvVar = 'PATH';
	} else if (process.platform === 'win32' && process.env.hasOwnProperty('Path')) {
		pathEnvVar = 'Path';
	}
	if (goRuntimeBasePath
		&& pathEnvVar
		&& process.env[pathEnvVar]
		&& (<string>process.env[pathEnvVar]).split(path.delimiter).indexOf(goRuntimeBasePath) === -1
	) {
		process.env[pathEnvVar] += path.delimiter + goRuntimeBasePath;
	}

	return new Promise<void>((resolve, reject) => {
		cp.execFile(goRuntimePath, ['env', 'GOPATH', 'GOROOT'], (err, stdout, stderr) => {
			if (err) {
				return reject();
			}
			const envOutput = stdout.split('\n');
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

let alreadyOfferedToInstallTools = false;

export function offerToInstallTools() {
	if (alreadyOfferedToInstallTools) {
		return;
	}
	alreadyOfferedToInstallTools = true;

	getGoVersion().then(goVersion => {
		getMissingTools(goVersion).then(missing => {
			missing = missing.filter(x => x.isImportant);
			if (missing.length > 0) {
				showGoStatus('Analysis Tools Missing', 'go.promptforinstall', 'Not all Go tools are available on the GOPATH');
				vscode.commands.registerCommand('go.promptforinstall', () => {
					promptForInstall(missing, goVersion);
				});
			}
		});

		const usingSourceGraph = getToolFromToolPath(getLanguageServerToolPath()) === 'go-langserver';
		if (usingSourceGraph && (!goVersion || goVersion.major > 1 || (goVersion.major === 1 && goVersion.minor > 10))) {
			const promptMsg = 'The language server from Sourcegraph is no longer under active development and it does not support Go modules as well. Please install and use the language server from Google or disable the use of language servers altogether.';
			const disableLabel = 'Disable language server';
			const installLabel = 'Install';
			vscode.window.showInformationMessage(promptMsg, installLabel, disableLabel)
				.then(selected => {
					if (selected === installLabel) {
						installTools([getTool('gopls')], goVersion)
							.then(() => {
								vscode.window.showInformationMessage('Reload VS Code window to enable the use of Go language server');
							});
					} else if (selected === disableLabel) {
						const goConfig = vscode.workspace.getConfiguration('go');
						const inspectLanguageServerSetting = goConfig.inspect('useLanguageServer');
						if (inspectLanguageServerSetting.globalValue === true) {
							goConfig.update('useLanguageServer', false, vscode.ConfigurationTarget.Global);
						} else if (inspectLanguageServerSetting.workspaceFolderValue === true) {
							goConfig.update('useLanguageServer', false, vscode.ConfigurationTarget.WorkspaceFolder);
						}
					}
				});
		}
	});

	function promptForInstall(missing: Tool[], goVersion: SemVersion) {
		const installItem = {
			title: 'Install',
			command() {
				hideGoStatus();
				installTools(missing, goVersion);
			}
		};
		const showItem = {
			title: 'Show',
			command() {
				outputChannel.clear();
				outputChannel.appendLine('Below tools are needed for the basic features of the Go extension.');
				missing.forEach(x => outputChannel.appendLine(x.name));
			}
		};
		vscode.window.showInformationMessage('Failed to find some of the Go analysis tools. Would you like to install them?', installItem, showItem).then(selection => {
			if (selection) {
				selection.command();
			} else {
				hideGoStatus();
			}
		});
	}
}

function getMissingTools(goVersion: SemVersion): Promise<Tool[]> {
	const keys = getConfiguredTools(goVersion);
	return Promise.all<Tool>(keys.map(tool => new Promise<Tool>((resolve, reject) => {
		const toolPath = getBinPath(tool.name);
		fs.exists(toolPath, exists => {
			resolve(exists ? null : tool);
		});
	}))).then(res => {
		return res.filter(x => x != null);
	});
}
