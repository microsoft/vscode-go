/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import { CancellationToken, CodeLens, Command, TextDocument } from 'vscode';
import { GoBaseCodeLensProvider } from './goBaseCodelens';
import { GoDocumentSymbolProvider } from './goOutline';
import { getBenchmarkFunctions, getTestFlags, getTestFunctionDebugArgs, getTestFunctions } from './testUtils';
import { getCurrentGoPath } from './util';

export class GoRunTestCodeLensProvider extends GoBaseCodeLensProvider {
	private readonly benchmarkRegex = /^Benchmark.+/;
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
		const config = vscode.workspace.getConfiguration('go', document.uri);
		const codeLensConfig: { [key: string]: any } = config.get('enableCodeLens');
		const codelensEnabled = codeLensConfig ? codeLensConfig['runtest'] : false;
		if (!codelensEnabled || !document.fileName.endsWith('_test.go')) {
			return [];
		}

		return Promise.all([
			this.getCodeLensForPackage(document, token),
			this.getCodeLensForFunctions(config, document, token)
		]).then(([pkg, fns]) => {
			let res: any[] = [];
			if (pkg && Array.isArray(pkg)) {
				res = res.concat(pkg);
			}
			if (fns && Array.isArray(fns)) {
				res = res.concat(fns);
			}
			return res;
		});
	}

	private async getCodeLensForPackage(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
		const documentSymbolProvider = new GoDocumentSymbolProvider();
		const symbols = await documentSymbolProvider.provideDocumentSymbols(document, token);
		const pkg = symbols[0].children.find(sym => sym.kind === vscode.SymbolKind.Package && !!sym.name);
		if (!pkg) {
			return;
		}
		const range = pkg.range;
		const packageCodeLens = [
			new CodeLens(range, {
				title: 'run package tests',
				command: 'go.test.package'
			}),
			new CodeLens(range, {
				title: 'run file tests',
				command: 'go.test.file'
			})
		];
		if (symbols[0].children.some(sym => sym.kind === vscode.SymbolKind.Function && this.benchmarkRegex.test(sym.name))) {
			packageCodeLens.push(new CodeLens(range, {
				title: 'run package benchmarks',
				command: 'go.benchmark.package'
			}), new CodeLens(range, {
				title: 'run file benchmarks',
				command: 'go.benchmark.file'
			}));
		}
		return packageCodeLens;
	}

	private async getCodeLensForFunctions(vsConfig: vscode.WorkspaceConfiguration, document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
		const codelens: CodeLens[] = [];

		const program = path.dirname(document.fileName);
		const env = Object.assign({}, this.debugConfig.env, vsConfig['testEnvVars']);
		const envFile = vsConfig['testEnvFile'];
		const buildFlags = getTestFlags(vsConfig);
		if (vsConfig['buildTags'] && buildFlags.indexOf('-tags') === -1) {
			buildFlags.push('-tags');
			buildFlags.push(`${vsConfig['buildTags']}`);
		}
		const currentDebugConfig = Object.assign({}, this.debugConfig, { program, env, envFile, buildFlags: buildFlags.map(x => `'${x}'`).join(' ') });

		const testPromise = getTestFunctions(document, token).then(testFunctions => {
			testFunctions.forEach(func => {
				const runTestCmd: Command = {
					title: 'run test',
					command: 'go.test.cursor',
					arguments: [{ functionName: func.name }]
				};

				codelens.push(new CodeLens(func.range, runTestCmd));

				const args = getTestFunctionDebugArgs(document, func.name, testFunctions);
				const debugTestCmd: Command = {
					title: 'debug test',
					command: 'go.debug.startSession',
					arguments: [Object.assign({}, currentDebugConfig, { args })]
				};

				codelens.push(new CodeLens(func.range, debugTestCmd));
			});
		});

		const benchmarkPromise = getBenchmarkFunctions(document, token).then(benchmarkFunctions => {
			benchmarkFunctions.forEach(func => {
				const runBenchmarkCmd: Command = {
					title: 'run benchmark',
					command: 'go.benchmark.cursor',
					arguments: [{ functionName: func.name }]
				};

				codelens.push(new CodeLens(func.range, runBenchmarkCmd));

				const debugTestCmd: Command = {
					title: 'debug benchmark',
					command: 'go.debug.startSession',
					arguments: [Object.assign({}, currentDebugConfig, { args: ['-test.bench', '^' + func.name + '$', '-test.run', 'a^'] })]
				};

				codelens.push(new CodeLens(func.range, debugTestCmd));
			});

		});

		await Promise.all([testPromise, benchmarkPromise]);
		return codelens;
	}
}
