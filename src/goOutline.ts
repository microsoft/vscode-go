/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath, sendTelemetryEvent } from './util';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';

// Keep in sync with https://github.com/lukehoban/go-outline
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
	fileName: string;
	importsOnly?: boolean;
}

export function documentSymbols(options: GoOutlineOptions): Promise<GoOutlineDeclaration[]> {
	return new Promise<GoOutlineDeclaration[]>((resolve, reject) => {
		let gooutline = getBinPath('go-outline');
		let gooutlineFlags = ['-f', options.fileName];
		if (options.importsOnly) {
			gooutlineFlags.push('-imports-only');
		}
		// Spawn `go-outline` process
		let p = cp.execFile(gooutline, gooutlineFlags, {}, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					promptForMissingTool('go-outline');
				}
				if (stderr && stderr.startsWith('flag provided but not defined: -imports-only')) {
					promptForUpdatingTool('go-outline');
					options.importsOnly = false;
					return documentSymbols(options).then(results => {
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
		let gotoSymbolConfig = vscode.workspace.getConfiguration('go')['gotoSymbol'];
		let includeImports = gotoSymbolConfig ? gotoSymbolConfig['includeImports'] : false;
		sendTelemetryEvent('file-symbols', { includeImports });
		decls.forEach(decl => {
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
				undefined,
				containerName);
			symbols.push(symbolInfo);
			if (decl.children) {
				this.convertToCodeSymbols(document, decl.children, symbols, decl.label);
			}
		});
	}

	public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
		let options = { fileName: document.fileName };
		return documentSymbols(options).then(decls => {
			let symbols: vscode.SymbolInformation[] = [];
			this.convertToCodeSymbols(document, decls, symbols, '');
			return symbols;
		});
	}
}
