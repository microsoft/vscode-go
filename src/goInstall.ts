import path = require('path');
import vscode = require('vscode');
import { getToolsEnvVars, getCurrentGoPath, getBinPath, getModuleCache } from './util';
import { outputChannel } from './goStatus';
import { getCurrentGoWorkspaceFromGOPATH, envPath } from './goPath';
import cp = require('child_process');
import { isModSupported } from './goModules';

export async function installCurrentPackage(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active, cannot find current package to install');
		return;
	}
	if (editor.document.languageId !== 'go') {
		vscode.window.showInformationMessage('File in the active editor is not a Go file, cannot find current package to install');
		return;
	}

	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		vscode.window.showErrorMessage(`Failed to run "go install" to install the package as the "go" binary cannot be found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`);
		return;
	}

	const env = Object.assign({}, getToolsEnvVars());
	const cwd = path.dirname(editor.document.uri.fsPath);
	const isMod = await isModSupported(editor.document.uri);

	// Skip installing if cwd is in the module cache
	if (isMod && cwd.startsWith(getModuleCache())) {
		return;
	}

	const goConfig = vscode.workspace.getConfiguration('go', editor.document.uri);
	const buildFlags = goConfig['buildFlags'] || [];
	const args = ['install', ...buildFlags];

	if (goConfig['buildTags'] && buildFlags.indexOf('-tags') === -1) {
		args.push('-tags', goConfig['buildTags']);
	}

	// Find the right importPath instead of directly using `.`. Fixes https://github.com/Microsoft/vscode-go/issues/846
	const currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), cwd);
	const importPath = (currentGoWorkspace && !isMod) ? cwd.substr(currentGoWorkspace.length + 1) : '.';
	args.push(importPath);

	outputChannel.clear();
	outputChannel.show();
	outputChannel.appendLine(`Installing ${importPath === '.' ? 'current package' : importPath}`);

	cp.execFile(goRuntimePath, args, { env, cwd }, (err, stdout, stderr) => {
		outputChannel.appendLine(err ? `Installation failed: ${stderr}` : `Installation successful`);
	});
}
