/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath, getFileArchive, getToolsEnvVars, killProcess, makeMemoizedByteOffsetConverter } from './util';
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

export enum GoOutlineImportsOptions {
	Include,
	Exclude,
	Only
}

export interface GoOutlineOptions {
	/**
	 * Path of the file for which outline is needed
	 */
	fileName: string;

	/**
	 * Option to decide if the output includes, excludes or only includes imports
	 * If the option is to only include imports, then the file will be parsed only till imports are collected
	 */
	importsOption: GoOutlineImportsOptions;

	/**
	 * Document to be parsed. If not provided, saved contents of the given fileName is used
	 */
	document?: vscode.TextDocument;

	/**
	 * Skips range information in the output.
	 * Calculating ranges is slightly expensive for large files, therefore skip it when not required.
	 */
	skipRanges?: boolean;
}

export function documentSymbols(options: GoOutlineOptions, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
	return runGoOutline(options, token).then(decls => {
		let symbols: vscode.SymbolInformation[] = [];
		convertToCodeSymbols(
			options.document,
			decls,
			symbols,
			'',
			options.importsOption !== GoOutlineImportsOptions.Exclude,
			(options.skipRanges || !options.document) ? null : makeMemoizedByteOffsetConverter(new Buffer(options.document.getText())));
		return symbols;
	});
}

export function runGoOutline(options: GoOutlineOptions, token: vscode.CancellationToken): Promise<GoOutlineDeclaration[]> {
	return new Promise<GoOutlineDeclaration[]>((resolve, reject) => {
		let gooutline = getBinPath('go-outline');
		let gooutlineFlags = ['-f', options.fileName];
		if (options.importsOption === GoOutlineImportsOptions.Only) {
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
						options.importsOption = GoOutlineImportsOptions.Include;
					}
					if (stderr.startsWith('flag provided but not defined: -modified')) {
						options.document = null;
					}
					p = null;
					return runGoOutline(options, token).then(results => {
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
		if (options.document && p.pid) {
			p.stdin.end(getFileArchive(options.document));
		}
	});
}

const goKindToCodeKind: { [key: string]: vscode.SymbolKind } = {
	'package': vscode.SymbolKind.Package,
	'import': vscode.SymbolKind.Namespace,
	'variable': vscode.SymbolKind.Variable,
	'type': vscode.SymbolKind.Interface,
	'function': vscode.SymbolKind.Function
};


function convertToCodeSymbols(
	document: vscode.TextDocument,
	decls: GoOutlineDeclaration[],
	symbols: vscode.SymbolInformation[],
	containerName: string,
	includeImports: boolean,
	byteOffsetToDocumentOffset: (byteOffset: number) => number): void {

	(decls || []).forEach(decl => {
		if (!includeImports && decl.type === 'import') return;

		let label = decl.label;

		if (label === '_' && decl.type === 'variable') return;

		if (decl.receiverType) {
			label = '(' + decl.receiverType + ').' + label;
		}

		let range = null;
		if (document && byteOffsetToDocumentOffset) {
			let start = byteOffsetToDocumentOffset(decl.start - 1);
			let end = byteOffsetToDocumentOffset(decl.end - 1);
			range = new vscode.Range(document.positionAt(start), document.positionAt(end));
		}

		let symbolInfo = new vscode.SymbolInformation(
			label,
			goKindToCodeKind[decl.type],
			range,
			document ? document.uri : null,
			containerName);
		symbols.push(symbolInfo);
		if (decl.children) {
			convertToCodeSymbols(document, decl.children, symbols, decl.label, includeImports, byteOffsetToDocumentOffset);
		}
	});
}

export class GoDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

	constructor(private includeImports?: boolean) {

	}


	public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
		if (typeof this.includeImports !== 'boolean') {
			let gotoSymbolConfig = vscode.workspace.getConfiguration('go', document.uri)['gotoSymbol'];
			this.includeImports = gotoSymbolConfig ? gotoSymbolConfig['includeImports'] : false;
		}
		let options = { fileName: document.fileName, document: document, importsOption: this.includeImports ? GoOutlineImportsOptions.Include : GoOutlineImportsOptions.Exclude };
		return documentSymbols(options, token);
	}
}
