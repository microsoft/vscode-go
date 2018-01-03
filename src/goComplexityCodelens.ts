/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import { TextDocument, CancellationToken, CodeLens, Command } from 'vscode';
import { GoDocumentSymbolProvider } from './goOutline';
import { getBinPath, getCurrentGoPath, canonicalizeGOPATHPrefix } from './util';
import { GoBaseCodeLensProvider } from './goBaseCodelens';
import { promptForMissingTool } from './goInstallTools';
import cp = require('child_process');

class ComplexityResult {
	complexity: number;

	package: string;

	function: string;

	constructor(complexity: number, pkg: string, functionName: string) {
		this.complexity = complexity;
		this.package = pkg;
		this.function = functionName;
	}
}

export class GoComplexityCodeLensProvider extends GoBaseCodeLensProvider {
	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
		if (!this.enabled) {
			return [];
		}
		let config = vscode.workspace.getConfiguration('go', document.uri);

		let codeLensConfig = config.get('enableCodeLens');
		let codelensEnabled = codeLensConfig
			? codeLensConfig['complexity']
			: false;

		let goCyclo = getBinPath('gocyclo');
		if (!path.isAbsolute(goCyclo)) {
			promptForMissingTool('gocyclo');
			codelensEnabled = false;
		}

		if (!codelensEnabled) {
			return [];
		}

		return this.runComplexityTool(goCyclo, document)
			.then((res) => this.getComplexity(res, document, token));
	}

	private runComplexityTool(goCyclo: string, document: TextDocument) {
		return new Promise<ComplexityResult[]>((resolve, reject) => {
			const result: ComplexityResult[] = [];

			let filename = canonicalizeGOPATHPrefix(document.fileName);
			let args = [filename];
			cp.execFile(goCyclo, args, (err, stdout, stderr) => {
				if (err) {
					if ((<any>err).code === 'ENOENT')
					{
						promptForMissingTool('gocyclo');
						return reject('Cannot find tool "gocyclo" to find references.');
					}
					if ((<any>err).killed !== true) {
						return reject(`Error running gocyclo: ${err.message || stderr}`);	
					}
				}

				let lines = stdout.split('\n');
				let res = lines.map((line) => {
					// Output line example from gocyclo:
					// 142 somepackage parseFrame path\to\file.go:2741:1

					// Regex has 6 capturing groups, of which (currently) the first three are used:
					// 1: cyclomatic complexity (142)
					// 2: package name (somepackage)
					// 3: function name (parseFrame)
					// 4: file path (path\to\file.go)
					// 5: line number (2741)
					// 6: Col (1)
					let match = /^([0-9]+)\s([a-z_]+)\s(.+)\s(.+):([0-9]+):([0-9]+)$/.exec(line);
					if (!match) { return undefined; }
					
					return new ComplexityResult(+match[1], match[2], match[3]);
				}).filter(a => { a !== undefined });

				resolve(res);
			});
		});
	}
	
	private getComplexity(toolResults: ComplexityResult[], document: TextDocument, token: CancellationToken): Thenable<CodeLens[]> {
		const codelens: CodeLens[] = [];

		let documentSymbolProvider = new GoDocumentSymbolProvider();

		let functionResults = documentSymbolProvider.provideDocumentSymbols(document, token)
			.then(symbols => {
				return symbols.filter(sym => sym.kind === vscode.SymbolKind.Function
					|| sym.kind == vscode.SymbolKind.Constructor)
			})
			.then(fns => {
				fns.forEach(func => {
					let result = toolResults.find(o => o.function === func.name);
					const range = func.location.range;
					codelens.push(new CodeLens(
						range,
						{ title: `Complexity is ${result.complexity}`, command: null}));
				});
			});

			let packageResult = documentSymbolProvider.provideDocumentSymbols(document, token)
			.then(symbols => { return symbols.find(sym => sym.kind === vscode.SymbolKind.Package && !!sym.name); })
			.then(pkg => {
				if (pkg) {
					let packageResults = toolResults.filter((val) => { return val.package === pkg.name });
					let topComplexity = Math.max(...packageResults.map(o => o.complexity));
					const range = pkg.location.range;
					codelens.push(new CodeLens(range, { title: `Complexity is ${topComplexity}`, command: null }));
				}
			});
		
		return Promise.all([functionResults, packageResult]).then(() => codelens);
	}
}
