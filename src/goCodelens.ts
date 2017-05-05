'use strict';

import vscode = require('vscode');
import { CodeLensProvider, SymbolInformation, SymbolKind, TextDocument, CancellationToken, CodeLens, Range, Command, Location, commands } from 'vscode';
import { documentSymbols, GoDocumentSymbolProvider } from './goOutline';
import { GoReferenceProvider } from './goReferences';

class ReferencesCodeLens extends CodeLens {
	constructor(
		public document: TextDocument,
		public symbol: SymbolInformation,
		range: Range
	) {
		super(range);
	}
}

export class GoCodeLensProvider implements CodeLensProvider {
	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
		let codeLensConfig = vscode.workspace.getConfiguration('go').get('enableCodeLens');
		let codelensEnabled = codeLensConfig ? codeLensConfig['references'] : false;
		if (!codelensEnabled) {
			return Promise.resolve([]);
		}

		return this.provideDocumentSymbols(document, token).then(symbols => {
			return symbols.map(symbol => {
				return new ReferencesCodeLens(document, symbol, symbol.location.range);
			});
		});
	}

	public resolveCodeLens?(inputCodeLens: CodeLens, token: CancellationToken): CodeLens | Thenable<CodeLens> {
		let codeLens = inputCodeLens as ReferencesCodeLens;

		if (token.isCancellationRequested) {
			return Promise.resolve(codeLens);
		}

		let options = {
			includeDeclaration: false
		};
		let position = codeLens.symbol.location.range.start;

		// Add offset for functions due to go parser returns always 1 as the start character in a line
		if (codeLens.symbol.kind === vscode.SymbolKind.Function) {
			position = position.translate(0, 5);
		}
		let referenceProvider = new GoReferenceProvider();
		return referenceProvider.provideReferences(codeLens.document, position, options, token).then(references => {
			if (references) {
				codeLens.command = {
					title: references.length === 1
						? '1 reference'
						: references.length + ' references',
					command: 'editor.action.showReferences',
					arguments: [codeLens.document.uri, position, references]
				};
			} else {
				codeLens.command = {
					title: 'No references found',
					command: ''
				};
			}
			return codeLens;
		});
	}

	private provideDocumentSymbols(document: TextDocument, token: CancellationToken): Thenable<vscode.SymbolInformation[]> {
		let symbolProvider = new GoDocumentSymbolProvider();
		let isTestFile = document.fileName.endsWith('_test.go');
		return symbolProvider.provideDocumentSymbols(document, token).then(symbols => {
			return symbols.filter(symbol => {

				if (symbol.kind === vscode.SymbolKind.Interface) {
					return true;
				}

				if (symbol.kind === vscode.SymbolKind.Function) {
					if (isTestFile && (symbol.name.startsWith('Test') || symbol.name.startsWith('Example') || symbol.name.startsWith('Benchmark'))) {
						return false;
					}
					return true;
				}

				return false;
			}
			);
		});
	}
}