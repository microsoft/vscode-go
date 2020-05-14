/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import { isModSupported } from './goModules';
import { envPath, getCurrentGoWorkspaceFromGOPATH } from './goPath';
import { outputChannel } from './goStatus';
import { getBinPath, getCurrentGoPath, getGoConfig, getModuleCache, getToolsEnvVars } from './util';

export async function installCurrentPackage(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active, cannot find current package to install');
		return;
	}
	if (editor.document.languageId !== 'go') {
		vscode.window.showInformationMessage(
			'File in the active editor is not a Go file, cannot find current package to install'
		);
		return;
	}

	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		vscode.window.showErrorMessage(
			`Failed to run "go install" to install the package as the "go" binary cannot be found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`
		);
		return;
	}

	const env = Object.assign({}, getToolsEnvVars());
	const cwd = path.dirname(editor.document.uri.fsPath);
	const isMod = await isModSupported(editor.document.uri);

	// Skip installing if cwd is in the module cache
	if (isMod && cwd.startsWith(getModuleCache())) {
		return;
	}

	const goConfig = getGoConfig();
	const buildFlags = goConfig['buildFlags'] || [];
	const args = ['install', ...buildFlags];

	if (goConfig['buildTags'] && buildFlags.indexOf('-tags') === -1) {
		args.push('-tags', goConfig['buildTags']);
	}

	// Find the right importPath instead of directly using `.`. Fixes https://github.com/Microsoft/vscode-go/issues/846
	const currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), cwd);
	const importPath = currentGoWorkspace && !isMod ? cwd.substr(currentGoWorkspace.length + 1) : '.';
	args.push(importPath);

	outputChannel.clear();
	outputChannel.show();
	outputChannel.appendLine(`Installing ${importPath === '.' ? 'current package' : importPath}`);

	cp.execFile(goRuntimePath, args, { env, cwd }, (err, stdout, stderr) => {
		outputChannel.appendLine(err ? `Installation failed: ${stderr}` : `Installation successful`);
	});
}
