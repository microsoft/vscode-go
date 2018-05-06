import path = require('path');
import vscode = require('vscode');
import { getToolsEnvVars, runTool, ICheckResult, handleDiagnosticErrors, getWorkspaceFolderPath, getGoVersion, SemVersion } from './util';
import { outputChannel } from './goStatus';
import { diagnosticsStatusBarItem } from './goStatus';

/**
 * Runs go vet in the current package or workspace.
 */
export function vetCode(vetWorkspace?: boolean) {
	let editor = vscode.window.activeTextEditor;
	if (!editor && !vetWorkspace) {
		vscode.window.showInformationMessage('No editor is active, cannot find current package to vet');
		return;
	}
	if (editor.document.languageId !== 'go' && !vetWorkspace) {
		vscode.window.showInformationMessage('File in the active editor is not a Go file, cannot find current package to vet');
		return;
	}

	let documentUri = editor ? editor.document.uri : null;
	let goConfig = vscode.workspace.getConfiguration('go', documentUri);

	outputChannel.clear(); // Ensures stale output from vet on save is cleared
	diagnosticsStatusBarItem.show();
	diagnosticsStatusBarItem.text = 'Vetting...';

	goVet(documentUri, goConfig, vetWorkspace)
		.then(warnings => {
			handleDiagnosticErrors(editor ? editor.document : null, warnings, vscode.DiagnosticSeverity.Warning);
			diagnosticsStatusBarItem.hide();
		})
		.catch(err => {
			vscode.window.showInformationMessage('Error: ' + err);
			diagnosticsStatusBarItem.text = 'Vetting Failed';
		});
}

/**
 * Runs go vet or go tool vet and presents the output in the 'Go' channel and in the diagnostic collections.
 *
 * @param fileUri Document uri.
 * @param goConfig Configuration for the Go extension.
 * @param vetWorkspace If true vets code in all workspace.
 */
export function goVet(fileUri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration, vetWorkspace?: boolean): Promise<ICheckResult[]> {
	if (running) {
		tokenSource.cancel();
	}

	const currentWorkspace = getWorkspaceFolderPath(fileUri);
	const cwd = (vetWorkspace && currentWorkspace) ? currentWorkspace : path.dirname(fileUri.fsPath);
	if (!path.isAbsolute(cwd)) {
		return Promise.resolve([]);
	}

	const vetFlags = goConfig['vetFlags'] || [];
	const vetEnv = Object.assign({}, getToolsEnvVars());
	const vetPromise = getGoVersion().then((version: SemVersion) => {
		const tagsArg = [];
		if (goConfig['buildTags'] && vetFlags.indexOf('-tags') === -1) {
			tagsArg.push('-tags');
			tagsArg.push(goConfig['buildTags']);
		}

		let vetArgs = ['vet', ...vetFlags, ...tagsArg, './...'];
		if (version && version.major === 1 && version.minor <= 9 && vetFlags.length) {
			vetArgs = ['tool', 'vet', ...vetFlags, ...tagsArg, '.'];
		}

		running = true;
		return runTool(
			vetArgs,
			cwd,
			'warning',
			true,
			null,
			vetEnv,
			false,
			tokenSource.token
		).then((result) => {
			running = false;
			return result;
		});
	});

	return vetPromise;
}

let tokenSource = new vscode.CancellationTokenSource();
let running = false;
