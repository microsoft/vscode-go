import path = require('path');
import vscode = require('vscode');
import { getToolsEnvVars, runTool, ICheckResult, handleDiagnosticErrors, getWorkspaceFolderPath, getCurrentGoPath } from './util';
import { outputChannel } from './goStatus';
import os = require('os');
import { getNonVendorPackages } from './goPackages';
import { getTestFlags } from './testUtils';
import { getCurrentGoWorkspaceFromGOPATH } from './goPath';

/**
 * Builds current package or workspace.
 */
export function buildCode(buildWorkspace?: boolean) {
	let editor = vscode.window.activeTextEditor;
	if (!editor && !buildWorkspace) {
		vscode.window.showInformationMessage('No editor is active, cannot find current package to build');
		return;
	}
	if (editor.document.languageId !== 'go' && !buildWorkspace) {
		vscode.window.showInformationMessage('File in the active editor is not a Go file, cannot find current package to build');
		return;
	}

	let documentUri = editor ? editor.document.uri : null;
	let goConfig = vscode.workspace.getConfiguration('go', documentUri);
	outputChannel.clear();
	outputChannel.show();
	outputChannel.appendLine('Building in progress...');
	goBuild(documentUri, goConfig, buildWorkspace)
		.then(errors => handleDiagnosticErrors(editor ? editor.document : null, errors, vscode.DiagnosticSeverity.Error))
		.catch(err => {
			vscode.window.showInformationMessage('Error: ' + err);
		});
}

/**
 * Runs go build -i or go test -i and presents the output in the 'Go' channel and in the diagnostic collections.
 *
 * @param fileUri Document uri.
 * @param goConfig Configuration for the Go extension.
 * @param buildWorkspace If true builds code in all workspace.
 */
export function goBuild(fileUri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration, buildWorkspace?: boolean): Promise<ICheckResult[]> {
	const buildEnv = Object.assign({}, getToolsEnvVars());
	const currentWorkspace = getWorkspaceFolderPath(fileUri);
	const cwd = path.dirname(fileUri.fsPath);
	const tmpPath = path.normalize(path.join(os.tmpdir(), 'go-code-check'));
	const isTestFile = fileUri.fsPath.endsWith('_test.go');

	let buildFlags: string[] = isTestFile ? getTestFlags(goConfig, null) : (Array.isArray(goConfig['buildFlags']) ? [...goConfig['buildFlags']] : []);
	// Remove the -i flag as it will be added later anyway
	if (buildFlags.indexOf('-i') > -1) {
		buildFlags.splice(buildFlags.indexOf('-i'), 1);
	}

	// If current file is a test file, then use `go test -c` instead of `go build` to find build errors
	let buildArgs: string[] = isTestFile ? ['test', '-c'] : ['build'];
	buildArgs.push('-i', '-o', tmpPath, ...buildFlags);
	if (goConfig['buildTags'] && buildFlags.indexOf('-tags') === -1) {
		buildArgs.push('-tags');
		buildArgs.push('"' + goConfig['buildTags'] + '"');
	}

	if (buildWorkspace && currentWorkspace && !isTestFile) {
		return getNonVendorPackages(currentWorkspace).then(pkgs => {
			let buildPromises = [];
			buildPromises = pkgs.map(pkgPath => {
				return runTool(
					buildArgs.concat(pkgPath),
					currentWorkspace,
					'error',
					true,
					null,
					buildEnv,
					true
				);
			});
			return Promise.all(buildPromises).then((resultSets) => {
				let results: ICheckResult[] = [].concat.apply([], resultSets);
				// Filter duplicates
				return results.filter((results, index, self) =>
					self.findIndex((t) => {
						return t.file === results.file && t.line === results.line && t.msg === results.msg && t.severity === results.severity;
					}) === index);
			});
		});
	}

	// Find the right importPath instead of directly using `.`. Fixes https://github.com/Microsoft/vscode-go/issues/846
	let currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), cwd);
	let importPath = currentGoWorkspace ? cwd.substr(currentGoWorkspace.length + 1) : '.';

	return runTool(
		buildArgs.concat(importPath),
		cwd,
		'error',
		true,
		null,
		buildEnv,
		true
	);





}
