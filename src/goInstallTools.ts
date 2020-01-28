/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import fs = require('fs');
import path = require('path');
import { SemVer } from 'semver';
import vscode = require('vscode');
import { getLanguageServerToolPath } from './goLanguageServer';
import { envPath, getToolFromToolPath } from './goPath';
import { hideGoStatus, outputChannel, showGoStatus } from './goStatus';
import {
	containsString,
	containsTool,
	disableModulesForWildcard,
	getConfiguredTools,
	getImportPath,
	getImportPathWithVersion,
	getTool,
	hasModSuffix,
	isGocode,
	Tool
} from './goTools';
import {
	getBinPath,
	getCurrentGoPath,
	getGoConfig,
	getGoVersion,
	getTempFilePath,
	getToolsGopath,
	GoVersion,
	resolvePath
} from './util';

// declinedUpdates tracks the tools that the user has declined to update.
const declinedUpdates: Tool[] = [];

// declinedUpdates tracks the tools that the user has declined to install.
const declinedInstalls: Tool[] = [];

export async function installAllTools(updateExistingToolsOnly: boolean = false) {
	const goVersion = await getGoVersion();
	let allTools = getConfiguredTools(goVersion);

	// exclude tools replaced by alternateTools.
	const alternateTools: { [key: string]: string } = getGoConfig().get('alternateTools');
	allTools = allTools.filter((tool) => {
		return !alternateTools[tool.name];
	});

	// Update existing tools by finding all tools the user has already installed.
	if (updateExistingToolsOnly) {
		installTools(
			allTools.filter((tool) => {
				const toolPath = getBinPath(tool.name);
				return toolPath && path.isAbsolute(toolPath);
			}),
			goVersion
		);
		return;
	}

	// Otherwise, allow the user to select which tools to install or update.
	vscode.window
		.showQuickPick(
			allTools.map((x) => {
				const item: vscode.QuickPickItem = {
					label: x.name,
					description: x.description
				};
				return item;
			}),
			{
				canPickMany: true,
				placeHolder: 'Select the tools to install/update.'
			}
		)
		.then((selectedTools) => {
			if (!selectedTools) {
				return;
			}
			installTools(
				selectedTools.map((x) => getTool(x.label)),
				goVersion
			);
		});
}

/**
 * ToolAtVersion is a Tool with version annotation.
 * Lack of version implies the latest version
 */
export interface ToolAtVersion extends Tool {
	version?: SemVer;
}

/**
 * Installs given array of missing tools. If no input is given, the all tools are installed
 *
 * @param missing array of tool names and optionally, their versions to be installed.
 *                If a tool's version is not specified, it will install the latest.
 * @param goVersion version of Go that affects how to install the tool. (e.g. modules vs legacy GOPATH mode)
 */
export function installTools(missing: ToolAtVersion[], goVersion: GoVersion): Promise<void> {
	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		vscode.window.showErrorMessage(
			`Failed to run "go get" to install the packages as the "go" binary cannot be found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`
		);
		return;
	}
	if (!missing) {
		return;
	}

	// http.proxy setting takes precedence over environment variables
	const httpProxy = vscode.workspace.getConfiguration('http', null).get('proxy');
	let envForTools = Object.assign({}, process.env);
	if (httpProxy) {
		envForTools = Object.assign({}, process.env, {
			http_proxy: httpProxy,
			HTTP_PROXY: httpProxy,
			https_proxy: httpProxy,
			HTTPS_PROXY: httpProxy
		});
	}

	outputChannel.show();
	outputChannel.clear();

	// If the go.toolsGopath is set, use its value as the GOPATH for the "go get" child process.
	// Else use the Current Gopath
	let toolsGopath = getToolsGopath();
	if (toolsGopath) {
		// User has explicitly chosen to use toolsGopath, so ignore GOBIN
		envForTools['GOBIN'] = '';
		outputChannel.appendLine(`Using the value ${toolsGopath} from the go.toolsGopath setting.`);
	} else {
		toolsGopath = getCurrentGoPath();
		outputChannel.appendLine(`go.toolsGopath setting is not set. Using GOPATH ${toolsGopath}`);
	}
	if (toolsGopath) {
		const paths = toolsGopath.split(path.delimiter);
		toolsGopath = paths[0];
		envForTools['GOPATH'] = toolsGopath;
	} else {
		const msg = 'Cannot install Go tools. Set either go.gopath or go.toolsGopath in settings.';
		vscode.window.showInformationMessage(msg, 'Open User Settings', 'Open Workspace Settings').then((selected) => {
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

	let installingMsg = `Installing ${missing.length} ${missing.length > 1 ? 'tools' : 'tool'} at `;
	if (envForTools['GOBIN']) {
		installingMsg += `the configured GOBIN: ${envForTools['GOBIN']}`;
	} else {
		installingMsg += toolsGopath + path.sep + 'bin';
	}

	// If the user is on Go >= 1.11, tools should be installed with modules enabled.
	// This ensures that users get the latest tagged version, rather than master,
	// which may be unstable.
	let modulesOff = false;
	if (goVersion.lt('1.11')) {
		modulesOff = true;
	} else {
		installingMsg += ' in module mode.';
	}

	outputChannel.appendLine(installingMsg);
	missing.forEach((missingTool) => {
		let toolName = missingTool.name;
		if (missingTool.version) {
			toolName += '@' + missingTool.version;
		}
		outputChannel.appendLine('  ' + toolName);
	});

	outputChannel.appendLine(''); // Blank line for spacing.

	// Install tools in a temporary directory, to avoid altering go.mod files.
	const toolsTmpDir = fs.mkdtempSync(getTempFilePath('go-tools-'));

	return missing
		.reduce((res: Promise<string[]>, tool: ToolAtVersion) => {
			return res.then(
				(sofar) =>
					new Promise<string[]>((resolve, reject) => {
						// Disable modules for tools which are installed with the "..." wildcard.
						// TODO: ... will be supported in Go 1.13, so enable these tools to use modules then.
						const modulesOffForTool = modulesOff || disableModulesForWildcard(tool, goVersion);
						let tmpGoModFile: string;
						if (modulesOffForTool) {
							envForTools['GO111MODULE'] = 'off';
						} else {
							envForTools['GO111MODULE'] = 'on';
							// Write a temporary go.mod file to avoid version conflicts.
							tmpGoModFile = path.join(toolsTmpDir, 'go.mod');
							fs.writeFileSync(tmpGoModFile, 'module tools');
						}

						const opts = {
							env: envForTools,
							cwd: toolsTmpDir
						};
						const callback = (err: Error, stdout: string, stderr: string) => {
							// Make sure to delete the temporary go.mod file, if it exists.
							if (tmpGoModFile && fs.existsSync(tmpGoModFile)) {
								fs.unlinkSync(tmpGoModFile);
							}
							const importPath = getImportPathWithVersion(tool, tool.version, goVersion);
							if (err) {
								outputChannel.appendLine('Installing ' + importPath + ' FAILED');
								const failureReason = tool.name + ';;' + err + stdout.toString() + stderr.toString();
								resolve([...sofar, failureReason]);
							} else {
								outputChannel.appendLine('Installing ' + importPath + ' SUCCEEDED');
								resolve([...sofar, null]);
							}
						};

						let closeToolPromise = Promise.resolve(true);
						const toolBinPath = getBinPath(tool.name);
						if (path.isAbsolute(toolBinPath) && isGocode(tool)) {
							closeToolPromise = new Promise<boolean>((innerResolve) => {
								cp.execFile(toolBinPath, ['close'], {}, (err, stdout, stderr) => {
									if (stderr && stderr.indexOf(`rpc: can't find service Server.`) > -1) {
										outputChannel.appendLine(
											'Installing gocode aborted as existing process cannot be closed. Please kill the running process for gocode and try again.'
										);
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
							if (modulesOffForTool) {
								args.push('-u');
							}
							// Tools with a "mod" suffix should not be installed,
							// instead we run "go build -o" to rename them.
							if (hasModSuffix(tool)) {
								args.push('-d');
							}
							let importPath: string;
							if (modulesOffForTool) {
								importPath = getImportPath(tool, goVersion);
							} else {
								importPath = getImportPathWithVersion(tool, tool.version, goVersion);
							}
							args.push(importPath);
							cp.execFile(goRuntimePath, args, opts, (err, stdout, stderr) => {
								if (stderr.indexOf('unexpected directory layout:') > -1) {
									outputChannel.appendLine(
										`Installing ${importPath} failed with error "unexpected directory layout". Retrying...`
									);
									cp.execFile(goRuntimePath, args, opts, callback);
								} else if (!err && hasModSuffix(tool)) {
									const outputFile = path.join(
										toolsGopath,
										'bin',
										process.platform === 'win32' ? `${tool.name}.exe` : tool.name
									);
									cp.execFile(
										goRuntimePath,
										['build', '-o', outputFile, getImportPath(tool, goVersion)],
										opts,
										callback
									);
								} else {
									callback(err, stdout, stderr);
								}
							});
						});
					})
			);
		}, Promise.resolve([]))
		.then((res) => {
			outputChannel.appendLine(''); // Blank line for spacing
			const failures = res.filter((x) => x != null);
			if (failures.length === 0) {
				if (containsString(missing, 'gopls')) {
					outputChannel.appendLine('Reload VS Code window to use the Go language server');
				}
				outputChannel.appendLine('All tools successfully installed. You are ready to Go :).');
				return;
			}

			outputChannel.appendLine(failures.length + ' tools failed to install.\n');
			failures.forEach((failure) => {
				const reason = failure.split(';;');
				outputChannel.appendLine(reason[0] + ':');
				outputChannel.appendLine(reason[1]);
			});
		});
}

export async function promptForMissingTool(toolName: string) {
	const tool = getTool(toolName);

	// If user has declined to install this tool, don't prompt for it.
	if (containsTool(declinedInstalls, tool)) {
		return;
	}

	const goVersion = await getGoVersion();
	// Show error messages for outdated tools.
	if (goVersion.lt('1.9')) {
		let outdatedErrorMsg;
		switch (tool.name) {
			case 'golint':
				outdatedErrorMsg =
					'golint no longer supports go1.8 or below, update your settings to use golangci-lint as go.lintTool and install golangci-lint';
				break;
			case 'gotests':
				outdatedErrorMsg =
					'Generate unit tests feature is not supported as gotests tool needs go1.9 or higher.';
				break;
		}
		if (outdatedErrorMsg) {
			vscode.window.showInformationMessage(outdatedErrorMsg);
			return;
		}
	}
	const installOptions = ['Install'];
	let missing = await getMissingTools(goVersion);
	if (!containsTool(missing, tool)) {
		return;
	}
	missing = missing.filter((x) => x === tool || tool.isImportant);
	if (missing.length > 1) {
		// Offer the option to install all tools.
		installOptions.push('Install All');
	}
	const msg = `The "${tool.name}" command is not available. Run "go get -v ${getImportPath(
		tool,
		goVersion
	)}" to install.`;
	vscode.window.showInformationMessage(msg, ...installOptions).then((selected) => {
		switch (selected) {
			case 'Install':
				installTools([tool], goVersion);
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
}

export async function promptForUpdatingTool(toolName: string, newVersion?: SemVer) {
	const tool = getTool(toolName);
	const toolVersion = {...tool, version: newVersion}; // ToolWithVersion

	// If user has declined to update, then don't prompt.
	if (containsTool(declinedUpdates, tool)) {
		return;
	}
	const goVersion = await getGoVersion();
	let updateMsg = `Your version of ${tool.name} appears to be out of date. Please update for an improved experience.`;
	const choices: string[] = ['Update'];
	if (toolName === `gopls`) {
		choices.push('Release Notes');
	}
	if (newVersion) {
		updateMsg = `New version of ${tool.name} (${newVersion}) is available. Please update for an improved experience.`;
	}
	vscode.window.showInformationMessage(updateMsg, ...choices).then((selected) => {
		switch (selected) {
			case 'Update':
				installTools([toolVersion], goVersion);
				break;
			case 'Release Notes':
				vscode.commands.executeCommand(
					'vscode.open',
					vscode.Uri.parse('https://github.com/golang/go/issues/33030#issuecomment-510151934')
				);
				break;
			default:
				declinedUpdates.push(tool);
				break;
		}
	});
}

export function updateGoPathGoRootFromConfig(): Promise<void> {
	const goroot = getGoConfig()['goroot'];
	if (goroot) {
		process.env['GOROOT'] = resolvePath(goroot);
	}

	if (process.env['GOPATH'] && process.env['GOROOT'] && process.env['GOPROXY']) {
		return Promise.resolve();
	}

	// If GOPATH is still not set, then use the one from `go env`
	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		vscode.window.showErrorMessage(
			`Failed to run "go env" to find GOPATH as the "go" binary cannot be found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`
		);
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
	if (
		goRuntimeBasePath &&
		pathEnvVar &&
		process.env[pathEnvVar] &&
		(<string>process.env[pathEnvVar]).split(path.delimiter).indexOf(goRuntimeBasePath) === -1
	) {
		process.env[pathEnvVar] += path.delimiter + goRuntimeBasePath;
	}

	return new Promise<void>((resolve, reject) => {
		cp.execFile(goRuntimePath, ['env', 'GOPATH', 'GOROOT', 'GOPROXY'], (err, stdout, stderr) => {
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
			if (!process.env['GOPROXY'] && envOutput[2] && envOutput[2].trim()) {
				process.env['GOPROXY'] = envOutput[2].trim();
			}
			return resolve();
		});
	});
}

let alreadyOfferedToInstallTools = false;

export async function offerToInstallTools() {
	if (alreadyOfferedToInstallTools) {
		return;
	}
	alreadyOfferedToInstallTools = true;

	const goVersion = await getGoVersion();
	let missing = await getMissingTools(goVersion);
	missing = missing.filter((x) => x.isImportant);
	if (missing.length > 0) {
		showGoStatus('Analysis Tools Missing', 'go.promptforinstall', 'Not all Go tools are available on the GOPATH');
		vscode.commands.registerCommand('go.promptforinstall', () => {
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
					missing.forEach((x) => outputChannel.appendLine(x.name));
				}
			};
			vscode.window
				.showInformationMessage(
					'Failed to find some of the Go analysis tools. Would you like to install them?',
					installItem,
					showItem
				)
				.then((selection) => {
					if (selection) {
						selection.command();
					} else {
						hideGoStatus();
					}
				});
		});
	}

	const usingSourceGraph = getToolFromToolPath(getLanguageServerToolPath()) === 'go-langserver';
	if (usingSourceGraph && goVersion.gt('1.10')) {
		const promptMsg =
			'The language server from Sourcegraph is no longer under active development and it does not support Go modules as well. Please install and use the language server from Google or disable the use of language servers altogether.';
		const disableLabel = 'Disable language server';
		const installLabel = 'Install';
		vscode.window.showInformationMessage(promptMsg, installLabel, disableLabel).then((selected) => {
			if (selected === installLabel) {
				installTools([getTool('gopls')], goVersion).then(() => {
					vscode.window.showInformationMessage(
						'Reload VS Code window to enable the use of Go language server'
					);
				});
			} else if (selected === disableLabel) {
				const goConfig = getGoConfig();
				const inspectLanguageServerSetting = goConfig.inspect('useLanguageServer');
				if (inspectLanguageServerSetting.globalValue === true) {
					goConfig.update('useLanguageServer', false, vscode.ConfigurationTarget.Global);
				} else if (inspectLanguageServerSetting.workspaceFolderValue === true) {
					goConfig.update('useLanguageServer', false, vscode.ConfigurationTarget.WorkspaceFolder);
				}
			}
		});
	}
}

function getMissingTools(goVersion: GoVersion): Promise<Tool[]> {
	const keys = getConfiguredTools(goVersion);
	return Promise.all<Tool>(
		keys.map(
			(tool) =>
				new Promise<Tool>((resolve, reject) => {
					const toolPath = getBinPath(tool.name);
					fs.exists(toolPath, (exists) => {
						resolve(exists ? null : tool);
					});
				})
		)
	).then((res) => {
		return res.filter((x) => x != null);
	});
}
