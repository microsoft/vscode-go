/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import { CodeLensProvider, TextDocument, CancellationToken, CodeLens, Command } from 'vscode';
import { getTestFunctions, getTestEnvVars } from './goTest';
import { GoDocumentSymbolProvider } from './goOutline';

export class GoRunTestCodeLensProvider implements CodeLensProvider {
	private readonly debugConfig: any = {
				'name': 'Launch',
				'type': 'go',
				'request': 'launch',
				'mode': 'test',
				'env': {
					'GOPATH': process.env['GOPATH'] // Passing current GOPATH to Delve as it runs in another process
				}
			};

	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
		let config = vscode.workspace.getConfiguration('go');
		let codeLensConfig = config.get('enableCodeLens');
		let codelensEnabled = codeLensConfig ? codeLensConfig['runtest'] : false;
		if (!codelensEnabled || !document.fileName.endsWith('_test.go')) {
			return;
		}

		return Promise.all([
			this.getCodeLensForPackage(document),
			this.getCodeLensForFunctions(config, document)
		]).then(res => {
			return res[0].concat(res[1]);
		});
	}

	private getCodeLensForPackage(document: TextDocument): Thenable<CodeLens[]> {
		let documentSymbolProvider = new GoDocumentSymbolProvider();
		return documentSymbolProvider.provideDocumentSymbols(document, null)
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

	private getCodeLensForFunctions(vsConfig: vscode.WorkspaceConfiguration, document: TextDocument): Thenable<CodeLens[]> {
		return getTestFunctions(document).then(testFunctions => {
			let codelens = [];

			testFunctions.forEach(func => {
				let runTestCmd: Command = {
					title: 'run test',
					command: 'go.test.cursor',
					arguments: [ { functionName: func.name} ]
				};

				const args = ['-test.run', func.name];
				const program = path.dirname(document.fileName);
				const env = Object.assign({ }, this.debugConfig.env, vsConfig['testEnvVars']);
				const envFile = vsConfig['testEnvFile'];

				let config = Object.assign({}, this.debugConfig, { args, program, env, envFile });
				let debugTestCmd: Command = {
					title: 'debug test',
					command: 'vscode.startDebug',
					arguments: [ config ]
				};

				codelens.push(new CodeLens(func.location.range, runTestCmd));
				codelens.push(new CodeLens(func.location.range, debugTestCmd));
			});
			return codelens;
		});
	}
}
