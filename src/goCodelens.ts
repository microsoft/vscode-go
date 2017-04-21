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
		let codelensEnabled = vscode.workspace.getConfiguration('go').get('referencesCodeLens.enabled');
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
		return this.provideSymbolReferences(codeLens.document, codeLens.symbol, token);
	}

	private provideDocumentSymbols(document: TextDocument, token: CancellationToken): Thenable<vscode.SymbolInformation[]> {
		let symbolProvider = new GoDocumentSymbolProvider();
		return symbolProvider.provideDocumentSymbols(document, token).then(symbols => {
			return symbols.filter(symbol =>
				symbol.kind === vscode.SymbolKind.Function ||
				symbol.kind === vscode.SymbolKind.Interface);
		});
	}

	private provideSymbolReferences(document: TextDocument, symbol: SymbolInformation, token: CancellationToken): Thenable<CodeLens> {
		if (token.isCancellationRequested) {
			return Promise.resolve(null);
		}

		let options = {
			includeDeclaration: false
		};
		let position = symbol.location.range.start;

		// Add offset for functions due to go parser returns always 1 as the start character in a line
		if (symbol.kind === vscode.SymbolKind.Function) {
			position = position.translate(0, 5);
		}
		let referenceProvider = new GoReferenceProvider();
		return referenceProvider.provideReferences(document, position, options, token).then(references => {
			if (!references) {
				return Promise.resolve(null);
			}

			let showReferences: Command = {
				title: references.length === 1
					? '1 reference'
					: references.length + ' references',
				command: 'editor.action.showReferences',
				arguments: [document.uri, position, references]
			};
			return new CodeLens(symbol.location.range, showReferences);
		});
	}
}