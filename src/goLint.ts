import path = require('path');
import vscode = require('vscode');
import os = require('os');
import cp = require('child_process');
import { getToolsEnvVars, resolvePath, getBinPath, runTool, ICheckResult } from './util';
import { outputChannel } from './goStatus';
import { getGoRuntimePath } from './goPath';

/**
 * Runs linter in the current package.
 *
 * @param fileUri Document uri.
 * @param goConfig Configuration for the Go extension.
 */
export function lintCurrentPackage(fileUri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration): Promise<ICheckResult[]> {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return Promise.resolve([]);
	}

	outputChannel.clear();
	return goLint(fileUri, goConfig);
}

/**
 * Runs linter in all packages in the current workspace.
 *
 * @param fileUri Document uri.
 * @param goConfig Configuration for the Go extension.
 */
export function lintWorkspace(fileUri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration): Promise<ICheckResult[]> {
	outputChannel.clear();
	return goLint(fileUri, goConfig, true);
}

/**
 * Runs linter and presents the output in the 'Go' channel and in the diagnostic collections.
 *
 * @param fileUri Document uri.
 * @param goConfig Configuration for the Go extension.
 * @param lintWorkspace If true runs linter in all workspace.
 */
export function goLint(fileUri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration, lintWorkspace?: boolean): Promise<ICheckResult[]> {
	let lintTool = goConfig['lintTool'] || 'golint';
	let lintFlags: string[] = goConfig['lintFlags'] || [];
	let lintEnv = Object.assign({}, getToolsEnvVars());
	let args = [];
	let configFlag = '--config=';
	lintFlags.forEach(flag => {
		// --json is not a valid flag for golint and in gometalinter, it is used to print output in json which we dont want
		if (flag === '--json') {
			return;
		}
		if (flag.startsWith(configFlag)) {
			let configFilePath = flag.substr(configFlag.length);
			configFilePath = resolvePath(configFilePath);
			args.push(`${configFlag}${configFilePath}`);
			return;
		}
		args.push(flag);
	});
	if (lintTool === 'gometalinter') {
		if (args.indexOf('--aggregate') === -1) {
			args.push('--aggregate');
		}
		if (goConfig['toolsGopath']) {
			// gometalinter will expect its linters to be in the GOPATH
			// So add the toolsGopath to GOPATH
			lintEnv['GOPATH'] += path.delimiter + goConfig['toolsGopath'];
		}
	}

	let lintWorkDir: string;

	if (lintWorkspace) {
		let currentWorkspace: string;
		if (fileUri) {
			let workspace = vscode.workspace.getWorkspaceFolder(fileUri);
			if (workspace) {
				currentWorkspace = workspace.uri.fsPath;
			}
		}

		if (!currentWorkspace) {
			// finding workspace root path
			let folders = vscode.workspace.workspaceFolders;
			if (folders && folders.length) {
				currentWorkspace = folders[0].uri.fsPath;
			} else {
				return Promise.resolve([]);
			}
		}

		lintWorkDir = currentWorkspace;
		args.push('./...');
	} else {
		lintWorkDir = path.dirname(fileUri.fsPath);
	}

	return runTool(
		args,
		lintWorkDir,
		'warning',
		false,
		lintTool,
		lintEnv
	);
}
