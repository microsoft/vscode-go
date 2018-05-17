import path = require('path');
import vscode = require('vscode');
import { getToolsEnvVars, resolvePath, runTool, ICheckResult, handleDiagnosticErrors, getWorkspaceFolderPath } from './util';
import { outputChannel } from './goStatus';
import { diagnosticsStatusBarItem } from './goStatus';
/**
 * Runs linter in the current package or workspace.
 */
export function lintCode(lintWorkspace?: boolean) {
	let editor = vscode.window.activeTextEditor;
	if (!editor && !lintWorkspace) {
		vscode.window.showInformationMessage('No editor is active, cannot find current package to lint');
		return;
	}
	if (editor.document.languageId !== 'go' && !lintWorkspace) {
		vscode.window.showInformationMessage('File in the active editor is not a Go file, cannot find current package to lint');
		return;
	}

	let documentUri = editor ? editor.document.uri : null;
	let goConfig = vscode.workspace.getConfiguration('go', documentUri);

	outputChannel.clear(); // Ensures stale output from lint on save is cleared
	diagnosticsStatusBarItem.show();
	diagnosticsStatusBarItem.text = 'Linting...';

	goLint(documentUri, goConfig, lintWorkspace)
		.then(warnings => {
			handleDiagnosticErrors(editor ? editor.document : null, warnings, vscode.DiagnosticSeverity.Warning);
			diagnosticsStatusBarItem.hide();
		})
		.catch(err => {
			vscode.window.showInformationMessage('Error: ' + err);
			diagnosticsStatusBarItem.text = 'Linting Failed';
		});
}

/**
 * Runs linter and presents the output in the 'Go' channel and in the diagnostic collections.
 *
 * @param fileUri Document uri.
 * @param goConfig Configuration for the Go extension.
 * @param lintWorkspace If true runs linter in all workspace.
 */
export function goLint(fileUri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration, lintWorkspace?: boolean): Promise<ICheckResult[]> {
	if (running) {
		tokenSource.cancel();
	}

	const currentWorkspace = getWorkspaceFolderPath(fileUri);
	const cwd = (lintWorkspace && currentWorkspace) ? currentWorkspace : path.dirname(fileUri.fsPath);
	if (!path.isAbsolute(cwd)) {
		return Promise.resolve([]);
	}

	const lintTool = goConfig['lintTool'] || 'golint';
	const lintFlags: string[] = goConfig['lintFlags'] || [];
	const lintEnv = Object.assign({}, getToolsEnvVars());
	const args = [];
	const configFlag = '--config=';

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

	if (lintWorkspace && currentWorkspace) {
		args.push('./...');
	}

	running = true;
	const lintPromise = runTool(
		args,
		cwd,
		'warning',
		false,
		lintTool,
		lintEnv,
		false,
		tokenSource.token
	).then((result) => {
		running = false;
		return result;
	});

	return lintPromise;
}

let tokenSource = new vscode.CancellationTokenSource();
let running = false;
