/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath, getToolsEnvVars } from './util';
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
		let convertToCodeSymbols = (decls: GoSymbolDeclaration[], symbols: vscode.SymbolInformation[]): void => {
			decls.forEach(decl => {
				let kind: vscode.SymbolKind;
				if (decl.kind !== '') {
					kind = this.goKindToCodeKind[decl.kind];
				}
				let pos = new vscode.Position(decl.line, decl.character);
				let symbolInfo = new vscode.SymbolInformation(
					decl.name,
					kind,
					new vscode.Range(pos, pos),
					vscode.Uri.file(decl.path),
					'');
				symbols.push(symbolInfo);
			});
		};
		let root = vscode.window.activeTextEditor ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri.fsPath : vscode.workspace.rootPath;

		return getWorkspaceSymbols(root, query).then(results => {
			let symbols: vscode.SymbolInformation[] = [];
			convertToCodeSymbols(results, symbols);
			return symbols;
		});
	}
}

export function getWorkspaceSymbols(workspacePath: string, query: string, goConfig?: vscode.WorkspaceConfiguration, ignoreFolderFeatureOn: boolean = true): Thenable<GoSymbolDeclaration[]> {
	if (!goConfig) {
		goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
	}
	let gotoSymbolConfig = goConfig['gotoSymbol'];
	let ignoreFolders: string[] = gotoSymbolConfig ? gotoSymbolConfig['ignoreFolders'] : [];
	let args = (ignoreFolderFeatureOn && ignoreFolders && ignoreFolders.length > 0) ? ['-ignore', ignoreFolders.join(',')] : [];
	args.push(workspacePath);
	args.push(query);
	let gosyms = getBinPath('go-symbols');
	let env = getToolsEnvVars();
	return new Promise((resolve, reject) => {
		let p = cp.execFile(gosyms, args, { maxBuffer: 1024 * 1024, env }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('go-symbols');
				}
				if (err && stderr && stderr.startsWith('flag provided but not defined: -ignore')) {
					promptForUpdatingTool('go-symbols');
					return getWorkspaceSymbols(workspacePath, query, goConfig, false).then(results => {
						return resolve(results);
					});
				}
				if (err) return resolve(null);
				let result = stdout.toString();
				let decls = <GoSymbolDeclaration[]>JSON.parse(result);
				return resolve(decls);
			} catch (e) {
				reject(e);
			}
		});
	});
}
