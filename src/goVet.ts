/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import path = require('path');
import vscode = require('vscode');
import { vetDiagnosticCollection } from './goMain';
import { diagnosticsStatusBarItem, outputChannel } from './goStatus';
import {
	getGoConfig,
	getGoVersion,
	getToolsEnvVars,
	getWorkspaceFolderPath,
	handleDiagnosticErrors,
	ICheckResult,
	resolvePath,
	runTool
} from './util';

/**
 * Runs go vet in the current package or workspace.
 */
export function vetCode(vetWorkspace?: boolean) {
	const editor = vscode.window.activeTextEditor;
	if (!editor && !vetWorkspace) {
		vscode.window.showInformationMessage('No editor is active, cannot find current package to vet');
		return;
	}
	if (editor.document.languageId !== 'go' && !vetWorkspace) {
		vscode.window.showInformationMessage(
			'File in the active editor is not a Go file, cannot find current package to vet'
		);
		return;
	}

	const documentUri = editor ? editor.document.uri : null;
	const goConfig = getGoConfig(documentUri);

	outputChannel.clear(); // Ensures stale output from vet on save is cleared
	diagnosticsStatusBarItem.show();
	diagnosticsStatusBarItem.text = 'Vetting...';

	goVet(documentUri, goConfig, vetWorkspace)
		.then((warnings) => {
			handleDiagnosticErrors(editor ? editor.document : null, warnings, vetDiagnosticCollection);
			diagnosticsStatusBarItem.hide();
		})
		.catch((err) => {
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
export async function goVet(
	fileUri: vscode.Uri,
	goConfig: vscode.WorkspaceConfiguration,
	vetWorkspace?: boolean
): Promise<ICheckResult[]> {
	epoch++;
	const closureEpoch = epoch;
	if (tokenSource) {
		if (running) {
			tokenSource.cancel();
		}
		tokenSource.dispose();
	}
	tokenSource = new vscode.CancellationTokenSource();

	const currentWorkspace = getWorkspaceFolderPath(fileUri);
	const cwd = vetWorkspace && currentWorkspace ? currentWorkspace : path.dirname(fileUri.fsPath);
	if (!path.isAbsolute(cwd)) {
		return Promise.resolve([]);
	}

	const vetFlags: string[] = goConfig['vetFlags'] || [];
	const vetEnv = Object.assign({}, getToolsEnvVars());
	const args: string[] = [];

	vetFlags.forEach((flag) => {
		if (flag.startsWith('--vettool=') || flag.startsWith('-vettool=')) {
			let vetToolPath = flag.substr(flag.indexOf('=') + 1).trim();
			if (!vetToolPath) {
				return;
			}
			vetToolPath = resolvePath(vetToolPath);
			args.push(`${flag.substr(0, flag.indexOf('=') + 1)}${vetToolPath}`);
			return;
		}
		args.push(flag);
	});

	const goVersion = await getGoVersion();
	const tagsArg = [];
	if (goConfig['buildTags'] && vetFlags.indexOf('-tags') === -1) {
		tagsArg.push('-tags');
		tagsArg.push(goConfig['buildTags']);
	}

	let vetArgs = ['vet', ...args, ...tagsArg, vetWorkspace ? './...' : '.'];
	if (goVersion.lt('1.10') && args.length) {
		vetArgs = ['tool', 'vet', ...args, ...tagsArg, '.'];
	}

	outputChannel.appendLine(`Starting "go vet" under the folder ${cwd}`);

	running = true;
	return runTool(vetArgs, cwd, 'warning', true, null, vetEnv, false, tokenSource.token).then((result) => {
		if (closureEpoch === epoch) {
			running = false;
		}
		return result;
	});
}

let epoch = 0;
let tokenSource: vscode.CancellationTokenSource;
let running = false;
