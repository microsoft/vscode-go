/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath, getToolsEnvVars, killProcess, getTimeoutConfiguration } from './util';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';

// Keep in sync with github.com/acroca/go-symbols'
interface GoSymbolDeclaration {
	name: string;
	kind: string;
	package: string;
	path: string;
	line: number;
	character: number;
}

export class GoWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {

	private goKindToCodeKind: { [key: string]: vscode.SymbolKind } = {
		'package': vscode.SymbolKind.Package,
		'import': vscode.SymbolKind.Namespace,
		'var': vscode.SymbolKind.Variable,
		'type': vscode.SymbolKind.Interface,
		'func': vscode.SymbolKind.Function,
		'const': vscode.SymbolKind.Constant,
	};

	public provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
		const convertToCodeSymbols = (decls: GoSymbolDeclaration[], symbols: vscode.SymbolInformation[]): void => {
			decls.forEach(decl => {
				let kind: vscode.SymbolKind;
				if (decl.kind !== '') {
					kind = this.goKindToCodeKind[decl.kind];
				}
				const pos = new vscode.Position(decl.line, decl.character);
				const symbolInfo = new vscode.SymbolInformation(
					decl.name,
					kind,
					new vscode.Range(pos, pos),
					vscode.Uri.file(decl.path),
					'');
				symbols.push(symbolInfo);
			});
		};
		let root = vscode.workspace.rootPath;
		if (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) {
			root = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri.fsPath;
		}

		const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);

		if (!root && !goConfig.gotoSymbol.includeGoroot) {
			vscode.window.showInformationMessage('No workspace is open to find symbols.');
			return;
		}

		return getWorkspaceSymbols(root, query, token, goConfig).then(results => {
			const symbols: vscode.SymbolInformation[] = [];
			convertToCodeSymbols(results, symbols);
			return symbols;
		});
	}
}

export function getWorkspaceSymbols(workspacePath: string, query: string, token: vscode.CancellationToken, goConfig?: vscode.WorkspaceConfiguration, ignoreFolderFeatureOn: boolean = true): Thenable<GoSymbolDeclaration[]> {
	if (!goConfig) {
		goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
	}
	const gotoSymbolConfig = goConfig['gotoSymbol'];
	const calls: Promise<GoSymbolDeclaration[]>[] = [];

	const ignoreFolders: string[] = gotoSymbolConfig ? gotoSymbolConfig['ignoreFolders'] : [];
	const baseArgs = (ignoreFolderFeatureOn && ignoreFolders && ignoreFolders.length > 0) ? ['-ignore', ignoreFolders.join(',')] : [];

	calls.push(callGoSymbols([...baseArgs, workspacePath, query], token));

	if (gotoSymbolConfig.includeGoroot) {
		const gorootCall = getGoroot()
			.then(goRoot => callGoSymbols([...baseArgs, goRoot, query], token));
		calls.push(gorootCall);
	}

	return Promise.all(calls)
		.then(([...results]) => <GoSymbolDeclaration[]>[].concat(...results))
		.catch((err: Error) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool('go-symbols');
			}
			if (err.message.startsWith('flag provided but not defined: -ignore')) {
				promptForUpdatingTool('go-symbols');
				return getWorkspaceSymbols(workspacePath, query, token, goConfig, false);
			}
		});
}

function callGoSymbols(args: string[], token: vscode.CancellationToken): Promise<GoSymbolDeclaration[]> {
	const gosyms = getBinPath('go-symbols');
	let p: cp.ChildProcess;

	if (token) {
		token.onCancellationRequested(() => killProcess(p));
	}

	// Set up execFile parameters
	const options: { [key: string]: any } = {
		env: getToolsEnvVars(),
		maxBuffer: 1024 * 1024
	};

	return new Promise((resolve, reject) => {
		p = cp.execFile(gosyms, args, options, (err, stdout, stderr) => {
			if (err && stderr && stderr.startsWith('flag provided but not defined: -ignore')) {
				return reject(new Error(stderr));
			} else if (err) {
				return reject(err);
			}
			const result = stdout.toString();
			const decls = <GoSymbolDeclaration[]>JSON.parse(result);
			return resolve(decls);
		});
		setTimeout(() => {
			killProcess(p);
			reject(new Error('Timeout executing tool - go-symbols'));
		}, getTimeoutConfiguration('onCommand'));
	});
}

function getGoroot(): Promise<string> {
	const goExecutable = getBinPath('go');
	if (!goExecutable) {
		return Promise.reject(new Error('Cannot find "go" binary. Update PATH or GOROOT appropriately'));
	}
	return new Promise((resolve, reject) => {
		const p = cp.execFile(goExecutable, ['env', 'GOROOT'], (err, stdout) => {
			if (err) {
				reject(err);
				return;
			}
			const [goRoot] = stdout.split('\n');
			resolve(goRoot.trim());
		});
		setTimeout(() => {
			killProcess(p);
			reject(new Error('Timeout executing tool - go env'));
		}, getTimeoutConfiguration('onCommand'));
	});
}
