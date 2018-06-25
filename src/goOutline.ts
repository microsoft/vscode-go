/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath, getFileArchive, getToolsEnvVars, killProcess } from './util';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';

// Keep in sync with https://github.com/ramya-rao-a/go-outline
export interface GoOutlineRange {
	start: number;
	end: number;
}

export interface GoOutlineDeclaration {
	label: string;
	type: string;
	receiverType?: string;
	icon?: string; // icon class or null to use the default images based on the type
	start: number;
	end: number;
	children?: GoOutlineDeclaration[];
	signature?: GoOutlineRange;
	comment?: GoOutlineRange;
}

export interface GoOutlineOptions {
	/**
	 * Path of the file for which outline is needed
	 */
	fileName: string;

	/**
	 * If true, then the file will be parsed only till imports are collected
	 */
	importsOnly?: boolean;

	/**
	 * Document to be parsed. If not provided, saved contents of the given fileName is used
	 */
	document?: vscode.TextDocument;
}

export function documentSymbols(options: GoOutlineOptions, token: vscode.CancellationToken): Promise<GoOutlineDeclaration[]> {
	return new Promise<GoOutlineDeclaration[]>((resolve, reject) => {
		let gooutline = getBinPath('go-outline');
		let gooutlineFlags = ['-f', options.fileName];
		if (options.importsOnly) {
			gooutlineFlags.push('-imports-only');
		}
		if (options.document) {
			gooutlineFlags.push('-modified');
		}

		let p: cp.ChildProcess;
		if (token) {
			token.onCancellationRequested(() => killProcess(p));
		}

		// Spawn `go-outline` process
		p = cp.execFile(gooutline, gooutlineFlags, { env: getToolsEnvVars() }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('go-outline');
				}
				if (stderr && stderr.startsWith('flag provided but not defined: ')) {
					promptForUpdatingTool('go-outline');
					if (stderr.startsWith('flag provided but not defined: -imports-only')) {
						options.importsOnly = false;
					}
					if (stderr.startsWith('flag provided but not defined: -modified')) {
						options.document = null;
					}
					p = null;
					return documentSymbols(options, token).then(results => {
						return resolve(results);
					});
				}
				if (err) return resolve(null);
				let result = stdout.toString();
				let decls = <GoOutlineDeclaration[]>JSON.parse(result);
				return resolve(decls);
			} catch (e) {
				reject(e);
			}
		});
		if (options.document) {
			p.stdin.end(getFileArchive(options.document));
		}
	});
}

export class GoDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

	private goKindToCodeKind: { [key: string]: vscode.SymbolKind } = {
		'package': vscode.SymbolKind.Package,
		'import': vscode.SymbolKind.Namespace,
		'variable': vscode.SymbolKind.Variable,
		'type': vscode.SymbolKind.Interface,
		'function': vscode.SymbolKind.Function
	};

	private convertToCodeSymbols(document: vscode.TextDocument, decls: GoOutlineDeclaration[], symbols: vscode.SymbolInformation[], containerName: string): void {
		let gotoSymbolConfig = vscode.workspace.getConfiguration('go', document.uri)['gotoSymbol'];
		let includeImports = gotoSymbolConfig ? gotoSymbolConfig['includeImports'] : false;
		(decls || []).forEach(decl => {
			if (!includeImports && decl.type === 'import') return;
			let label = decl.label;
			if (decl.receiverType) {
				label = '(' + decl.receiverType + ').' + label;
			}

			let codeBuf = new Buffer(document.getText());
			let start = codeBuf.slice(0, decl.start - 1).toString().length;
			let end = codeBuf.slice(0, decl.end - 1).toString().length;

			let symbolInfo = new vscode.SymbolInformation(
				label,
				this.goKindToCodeKind[decl.type],
				new vscode.Range(document.positionAt(start), document.positionAt(end)),
				document.uri,
				containerName);
			symbols.push(symbolInfo);
			if (decl.children) {
				this.convertToCodeSymbols(document, decl.children, symbols, decl.label);
			}
		});
	}

	public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
		let options = { fileName: document.fileName, document: document };
		return documentSymbols(options, token).then(decls => {
			let symbols: vscode.SymbolInformation[] = [];
			this.convertToCodeSymbols(document, decls, symbols, '');
			return symbols;
		});
	}
}
