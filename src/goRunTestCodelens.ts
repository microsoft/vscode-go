/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import { TextDocument, CancellationToken, CodeLens, Command } from 'vscode';
import { getTestFunctions, getBenchmarkFunctions, getTestFlags } from './testUtils';
import { GoDocumentSymbolProvider } from './goOutline';
import { getCurrentGoPath } from './util';
import { GoBaseCodeLensProvider } from './goBaseCodelens';

export class GoRunTestCodeLensProvider extends GoBaseCodeLensProvider {
	private readonly debugConfig: any = {
		'name': 'Launch',
		'type': 'go',
		'request': 'launch',
		'mode': 'test',
		'env': {
			'GOPATH': getCurrentGoPath() // Passing current GOPATH to Delve as it runs in another process
		}
	};

	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
		if (!this.enabled) {
			return [];
		}
		let config = vscode.workspace.getConfiguration('go', document.uri);
		let codeLensConfig = config.get('enableCodeLens');
		let codelensEnabled = codeLensConfig ? codeLensConfig['runtest'] : false;
		if (!codelensEnabled || !document.fileName.endsWith('_test.go')) {
			return;
		}

		return Promise.all([
			this.getCodeLensForPackage(document, token),
			this.getCodeLensForFunctions(config, document, token)
		]).then(([pkg, fns]) => {
			const res = [];
			if (pkg && Array.isArray(pkg)) {
				res.concat(pkg);
			}
			if (fns && Array.isArray(fns)) {
				res.concat(fns);
			}
			return res;
		});
	}

	private getCodeLensForPackage(document: TextDocument, token: CancellationToken): Thenable<CodeLens[]> {
		let documentSymbolProvider = new GoDocumentSymbolProvider();
		return documentSymbolProvider.provideDocumentSymbols(document, token)
			.then(symbols => symbols.find(sym => sym.kind === vscode.SymbolKind.Package && !!sym.name))
			.then(pkg => {
				if (pkg) {
					const range = pkg.location.range;
					return [
						new CodeLens(range, {
							title: 'run package tests',
							command: 'go.test.package'
						}),
						new CodeLens(range, {
							title: 'run file tests',
							command: 'go.test.file'
						})
					];
				}
			});
	}

	private getCodeLensForFunctions(vsConfig: vscode.WorkspaceConfiguration, document: TextDocument, token: CancellationToken): Thenable<CodeLens[]> {
		const codelens: CodeLens[] = [];

		const testPromise = getTestFunctions(document, token).then(testFunctions => {
			testFunctions.forEach(func => {
				let runTestCmd: Command = {
					title: 'run test',
					command: 'go.test.cursor',
					arguments: [{ functionName: func.name }]
				};

				const args = ['-test.run', func.name];
				const program = path.dirname(document.fileName);
				const env = Object.assign({}, this.debugConfig.env, vsConfig['testEnvVars']);
				const envFile = vsConfig['testEnvFile'];
				let buildFlags = getTestFlags(vsConfig, null);
				if (vsConfig['buildTags'] && buildFlags.indexOf('-tags') === -1) {
					buildFlags.push('-tags');
					buildFlags.push(`${vsConfig['buildTags']}`);
				}

				let config = Object.assign({}, this.debugConfig, { args, program, env, envFile, buildFlags: buildFlags.map(x => `'${x}'`).join(' ') });
				let debugTestCmd: Command = {
					title: 'debug test',
					command: 'go.debug.startSession',
					arguments: [config]
				};

				codelens.push(new CodeLens(func.location.range, runTestCmd));
				codelens.push(new CodeLens(func.location.range, debugTestCmd));
			});
		});

		const benchmarkPromise = getBenchmarkFunctions(document, token).then(benchmarkFunctions => {
			benchmarkFunctions.forEach(func => {
				let runBenchmarkCmd: Command = {
					title: 'run benchmark',
					command: 'go.benchmark.cursor',
					arguments: [{ functionName: func.name }]
				};

				codelens.push(new CodeLens(func.location.range, runBenchmarkCmd));
			});

		});

		return Promise.all([testPromise, benchmarkPromise]).then(() => codelens);
	}
}
