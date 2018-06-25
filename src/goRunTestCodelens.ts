/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import { TextDocument, CancellationToken, CodeLens, Command } from 'vscode';
import { getTestFunctions, getBenchmarkFunctions, getTestFlags, extractInstanceTestName, findAllTestSuiteRuns } from './testUtils';
import { GoDocumentSymbolProvider } from './goOutline';
import { getCurrentGoPath } from './util';
import { GoBaseCodeLensProvider } from './goBaseCodelens';

export class GoRunTestCodeLensProvider extends GoBaseCodeLensProvider {
	private readonly defaultDebugConfig: any = {
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
			return [];
		}

		return Promise.all([
			this.getCodeLensForPackage(document, token),
			this.getCodeLensForFunctions(config, document, token)
		]).then(([pkg, fns]) => {
			let res = [];
			if (pkg && Array.isArray(pkg)) {
				res = res.concat(pkg);
			}
			if (fns && Array.isArray(fns)) {
				res = res.concat(fns);
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
		const debugConfig = this.getDebugConfig(vsConfig);
		const program = path.dirname(document.fileName);
		const env = Object.assign({}, debugConfig.env, vsConfig['testEnvVars']);
		const envFile = vsConfig['testEnvFile'];
		const buildFlags = getTestFlags(vsConfig, null);
		if (vsConfig['buildTags'] && buildFlags.indexOf('-tags') === -1) {
			buildFlags.push('-tags');
			buildFlags.push(`${vsConfig['buildTags']}`);
		}
		const currentDebugConfig = Object.assign({}, debugConfig, { program, env, envFile, buildFlags: buildFlags.map(x => `'${x}'`).join(' ') });

		const testPromise = getTestFunctions(document, token).then(testFunctions => {
			testFunctions.forEach(func => {
				let runTestCmd: Command = {
					title: 'run test',
					command: 'go.test.cursor',
					arguments: [{ functionName: func.name }]
				};

				codelens.push(new CodeLens(func.location.range, runTestCmd));

				let args: string[] = [];
				let instanceMethod = extractInstanceTestName(func.name);
				if (instanceMethod) {
					const testFns = findAllTestSuiteRuns(document, testFunctions);
					if (testFns && testFns.length > 0) {
						args = args.concat('-test.run', `^${testFns.map(t => t.name).join('|')}$`);
					}
					args = args.concat('-testify.m', `^${instanceMethod}$`);
				} else {
					args = args.concat('-test.run', `^${func.name}$`);
				}

				let debugTestCmd: Command = {
					title: 'debug test',
					command: 'go.debug.startSession',
					arguments: [Object.assign({}, currentDebugConfig, { args: args })]
				};

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

				let debugTestCmd: Command = {
					title: 'debug benchmark',
					command: 'go.debug.startSession',
					arguments: [Object.assign({}, currentDebugConfig, { args: ['-test.bench', '^' + func.name + '$', '-test.run', 'a^'] })]
				};

				codelens.push(new CodeLens(func.location.range, debugTestCmd));
			});

		});

		return Promise.all([testPromise, benchmarkPromise]).then(() => codelens);
	}

	private getDebugConfig(vsConfig: vscode.WorkspaceConfiguration): any {
		let debugConfig: any = this.defaultDebugConfig;
		let delveConfig: any = vsConfig.get('delveConfig');

		if (delveConfig !== undefined) {
			if (delveConfig.useApiV1 !== undefined) {
				debugConfig.useApiV1 = delveConfig.useApiV1;
			}
			if (delveConfig.dlvLoadConfig !== undefined) {
				debugConfig.dlvLoadConfig = {
					followPointers: delveConfig.dlvLoadConfig.followPointers,
					maxVariableRecurse: delveConfig.dlvLoadConfig.maxVariableRecurse,
					maxStringLen: delveConfig.dlvLoadConfig.maxStringLen,
					maxArrayValues: delveConfig.dlvLoadConfig.maxArrayValues,
					maxStructFields: delveConfig.dlvLoadConfig.maxStructFields
				};
			}
		}

		return debugConfig;
	}
}
