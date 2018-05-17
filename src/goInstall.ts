import path = require('path');
import vscode = require('vscode');
import { getToolsEnvVars, getCurrentGoPath } from './util';
import { outputChannel } from './goStatus';
import { getCurrentGoWorkspaceFromGOPATH, getGoRuntimePath } from './goPath';
import cp = require('child_process');

export function installCurrentPackage() {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active, cannot find current package to install');
		return;
	}
	if (editor.document.languageId !== 'go') {
		vscode.window.showInformationMessage('File in the active editor is not a Go file, cannot find current package to install');
		return;
	}

	let goRuntimePath = getGoRuntimePath();
	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return;
	}

	const env = Object.assign({}, getToolsEnvVars());
	const cwd = path.dirname(editor.document.uri.fsPath);
	const goConfig = vscode.workspace.getConfiguration('go', editor.document.uri);
	const buildFlags = goConfig['buildFlags'] || [];
	const args = ['install', ...buildFlags];

	if (goConfig['buildTags'] && buildFlags.indexOf('-tags') === -1) {
		args.push('-tags', goConfig['buildTags']);
	}

	// Find the right importPath instead of directly using `.`. Fixes https://github.com/Microsoft/vscode-go/issues/846
	const currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), cwd);
	const importPath = currentGoWorkspace ? cwd.substr(currentGoWorkspace.length + 1) : '.';
	args.push(importPath);

	outputChannel.clear();
	outputChannel.show();
	outputChannel.appendLine(`Installing ${importPath === '.' ? 'current package' : importPath}`);

	cp.execFile(goRuntimePath, args, { env, cwd }, (err, stdout, stderr) => {
		outputChannel.appendLine(err ? `Installation failed: ${stderr}` : `Installation successful`);
	});
}