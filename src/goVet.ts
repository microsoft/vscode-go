import path = require('path');
import vscode = require('vscode');
import { getToolsEnvVars, runTool, ICheckResult, handleDiagnosticErrors, getWorkspaceFolderPath } from './util';
import { outputChannel } from './goStatus';

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
	outputChannel.clear();
	outputChannel.show();
	outputChannel.appendLine('Vetting in progress...');
	goVet(documentUri, goConfig, vetWorkspace)
		.then(warnings => handleDiagnosticErrors(editor ? editor.document : null, warnings, vscode.DiagnosticSeverity.Warning))
		.catch(err => {
			vscode.window.showInformationMessage('Error: ' + err);
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
	let vetFlags = goConfig['vetFlags'] || [];
	let vetEnv = Object.assign({}, getToolsEnvVars());
	let vetArgs = vetFlags.length ? ['tool', 'vet', ...vetFlags, '.'] : ['vet', './...'];
	let currentWorkspace = getWorkspaceFolderPath(fileUri);

	if (running) {
		tokenSource.cancel();
	}

	running = true;
	const vetPromise = runTool(
		vetArgs,
		(vetWorkspace && currentWorkspace) ? currentWorkspace : path.dirname(fileUri.fsPath),
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

	return vetPromise;
}

let tokenSource = new vscode.CancellationTokenSource();
let running = false;
