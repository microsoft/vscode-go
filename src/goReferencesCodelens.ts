'use strict';

import vscode = require('vscode');
import { SymbolInformation, TextDocument, CancellationToken, CodeLens, Range, Command, Location, commands } from 'vscode';
import { GoDocumentSymbolProvider } from './goOutline';
import { GoReferenceProvider } from './goReferences';
import { GoBaseCodeLensProvider } from './goBaseCodelens';

const methodRegex = /^func\s+\(\s*\w+\s+\*?\w+\s*\)\s+/;

class ReferencesCodeLens extends CodeLens {
	constructor(
		public document: TextDocument,
		range: Range
	) {
		super(range);
	}
}

export class GoReferencesCodeLensProvider extends GoBaseCodeLensProvider {
	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
		if (!this.enabled) {
			return [];
		}
		const codeLensConfig: { [key: string]: any } = vscode.workspace.getConfiguration('go', document.uri).get('enableCodeLens');
		const codelensEnabled = codeLensConfig ? codeLensConfig['references'] : false;
		if (!codelensEnabled) {
			return Promise.resolve([]);
		}

		return this.provideDocumentSymbols(document, token).then(symbols => {
			return symbols.map(symbol => {
				let position = symbol.range.start;

				// Add offset for functions as go-outline returns position at the keyword func instead of func name
				if (symbol.kind === vscode.SymbolKind.Function) {
					const funcDecl = document.lineAt(position.line).text.substr(position.character);
					const match = methodRegex.exec(funcDecl);
					position = position.translate(0, match ? match[0].length : 5);
				}
				return new ReferencesCodeLens(document, new vscode.Range(position, position));
			});
		});
	}

	public resolveCodeLens?(inputCodeLens: CodeLens, token: CancellationToken): CodeLens | Thenable<CodeLens> {
		const codeLens = inputCodeLens as ReferencesCodeLens;

		if (token.isCancellationRequested) {
			return Promise.resolve(codeLens);
		}

		const options = {
			includeDeclaration: false
		};
		const referenceProvider = new GoReferenceProvider();
		return referenceProvider.provideReferences(codeLens.document, codeLens.range.start, options, token).then(references => {
			codeLens.command = {
				title: references.length === 1
					? '1 reference'
					: references.length + ' references',
				command: 'editor.action.showReferences',
				arguments: [codeLens.document.uri, codeLens.range.start, references]
			};
			return codeLens;
		}, err => {
			console.log(err);
			codeLens.command = {
				title: 'Error finding references',
				command: ''
			};
			return codeLens;
		});
	}

	private async provideDocumentSymbols(document: TextDocument, token: CancellationToken): Promise<vscode.DocumentSymbol[]> {
		const symbolProvider = new GoDocumentSymbolProvider();
		const isTestFile = document.fileName.endsWith('_test.go');
		const symbols = await symbolProvider.provideDocumentSymbols(document, token);
		return symbols[0].children.filter(symbol => {
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
		});
	}
}
