import path = require('path');
import vscode = require('vscode');
import { getToolsEnvVars, runTool, ICheckResult, handleDiagnosticErrors, getWorkspaceFolderPath, getCurrentGoPath, getTempFilePath, getModuleCache } from './util';
import { outputChannel } from './goStatus';
import { getNonVendorPackages } from './goPackages';
import { getTestFlags } from './testUtils';
import { getCurrentGoWorkspaceFromGOPATH } from './goPath';
import { diagnosticsStatusBarItem } from './goStatus';
import { isModSupported } from './goModules';
import { buildDiagnosticCollection } from './goMain';
/**
 * Builds current package or workspace.
 */
export function buildCode(buildWorkspace?: boolean) {
	let editor = vscode.window.activeTextEditor;
	if (!buildWorkspace) {
		if (!editor) {
			vscode.window.showInformationMessage('No editor is active, cannot find current package to build');
			return;
		}
		if (editor.document.languageId !== 'go') {
			vscode.window.showInformationMessage('File in the active editor is not a Go file, cannot find current package to build');
			return;
		}
	}

	let documentUri = editor ? editor.document.uri : null;
	let goConfig = vscode.workspace.getConfiguration('go', documentUri);

	outputChannel.clear(); // Ensures stale output from build on save is cleared
	diagnosticsStatusBarItem.show();
	diagnosticsStatusBarItem.text = 'Building...';

	isModSupported(documentUri).then(isMod => {
		goBuild(documentUri, isMod, goConfig, buildWorkspace)
		.then(errors => {
			handleDiagnosticErrors(editor ? editor.document : null, errors, buildDiagnosticCollection);
			diagnosticsStatusBarItem.hide();
		})
		.catch(err => {
			vscode.window.showInformationMessage('Error: ' + err);
			diagnosticsStatusBarItem.text = 'Build Failed';
		});
	});
}

/**
 * Runs go build -i or go test -i and presents the output in the 'Go' channel and in the diagnostic collections.
 *
 * @param fileUri Document uri.
 * @param isMod Boolean denoting if modules are being used.
 * @param goConfig Configuration for the Go extension.
 * @param buildWorkspace If true builds code in all workspace.
 */
export async function goBuild(fileUri: vscode.Uri, isMod: boolean, goConfig: vscode.WorkspaceConfiguration, buildWorkspace?: boolean): Promise<ICheckResult[]> {
	epoch++;
	let closureEpoch = epoch;
	if (tokenSource) {
		if (running) {
			tokenSource.cancel();
		}
		tokenSource.dispose();
	}
	tokenSource = new vscode.CancellationTokenSource();
	let updateRunning = () => {
		if (closureEpoch === epoch)
			running = false;
	};

	const currentWorkspace = getWorkspaceFolderPath(fileUri);
	const cwd = (buildWorkspace && currentWorkspace) ? currentWorkspace : path.dirname(fileUri.fsPath);
	if (!path.isAbsolute(cwd)) {
		return Promise.resolve([]);
	}

	// Skip building if cwd is in the module cache
	if (isMod && cwd.startsWith(getModuleCache())) {
		return [];
	}

	const buildEnv = Object.assign({}, getToolsEnvVars());
	const tmpPath = getTempFilePath('go-code-check');
	const isTestFile = fileUri && fileUri.fsPath.endsWith('_test.go');
	const buildFlags: string[] = isTestFile ? getTestFlags(goConfig) : (Array.isArray(goConfig['buildFlags']) ? [...goConfig['buildFlags']] : []);
	const buildArgs: string[] = isTestFile ? ['test', '-c'] : ['build'];

	if (goConfig['installDependenciesWhenBuilding'] === true && !isMod) {
		buildArgs.push('-i');
		// Remove the -i flag from user as we add it anyway
		if (buildFlags.indexOf('-i') > -1) {
			buildFlags.splice(buildFlags.indexOf('-i'), 1);
		}
	}
	buildArgs.push(...buildFlags);
	if (goConfig['buildTags'] && buildFlags.indexOf('-tags') === -1) {
		buildArgs.push('-tags');
		buildArgs.push(goConfig['buildTags']);
	}

	if (buildWorkspace && currentWorkspace && !isTestFile) {
		outputChannel.appendLine(`Starting building the current workspace at ${currentWorkspace}`);
		return getNonVendorPackages(currentWorkspace).then(pkgs => {
			running = true;
			return runTool(
				buildArgs.concat(Array.from(pkgs.keys())),
				currentWorkspace,
				'error',
				true,
				null,
				buildEnv,
				true,
				tokenSource.token
			).then(v => {
				updateRunning();
				return v;
			});
		});
	}

	// Find the right importPath instead of directly using `.`. Fixes https://github.com/Microsoft/vscode-go/issues/846
	let currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), cwd);
	let importPath = (currentGoWorkspace && !isMod) ? cwd.substr(currentGoWorkspace.length + 1) : '.';
	running = true;
	outputChannel.appendLine(`Starting building the current package at ${cwd}`);
	return runTool(
		buildArgs.concat('-o', tmpPath, importPath),
		cwd,
		'error',
		true,
		null,
		buildEnv,
		true,
		tokenSource.token
	).then(v => {
		updateRunning();
		return v;
	});
}

let epoch = 0;
let tokenSource: vscode.CancellationTokenSource;
let running = false;
