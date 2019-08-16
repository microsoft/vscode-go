/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { GO_MODE } from './goMode';
import {
	LanguageClient, RevealOutputChannelOn, FormattingOptions, ProvideDocumentFormattingEditsSignature,
	ProvideCompletionItemsSignature, ProvideRenameEditsSignature, ProvideDefinitionSignature, ProvideHoverSignature,
	ProvideReferencesSignature, ProvideSignatureHelpSignature, ProvideDocumentSymbolsSignature, ProvideWorkspaceSymbolsSignature,
	HandleDiagnosticsSignature, ProvideDocumentLinksSignature,
} from 'vscode-languageclient';
import { ProvideTypeDefinitionSignature } from 'vscode-languageclient/lib/typeDefinition';
import { ProvideImplementationSignature } from 'vscode-languageclient/lib/implementation';
import { getToolFromToolPath } from './goPath';
import { getToolsEnvVars } from './util'
import { getCompletionsWithoutGoCode } from './goSuggest';
import { GoCompletionItemProvider } from './goSuggest';
import { GoHoverProvider } from './goExtraInfo';
import { GoDefinitionProvider } from './goDeclaration';
import { GoReferenceProvider } from './goReferences';
import { GoImplementationProvider } from './goImplementations';
import { GoTypeDefinitionProvider } from './goTypeDefinition';
import { GoDocumentFormattingEditProvider } from './goFormat';
import { GoRenameProvider } from './goRename';
import { GoDocumentSymbolProvider } from './goOutline';
import { GoSignatureHelpProvider } from './goSignature';
import { GoWorkspaceSymbolProvider } from './goSymbol';
import { parseLiveFile } from './goLiveErrors';

export function registerLanguageServer(ctx: vscode.ExtensionContext, toolPath: string) {
	const goConfig = vscode.workspace.getConfiguration('go');
	const languageServerConfig: any = goConfig.get('languageServer');
	let enabled: any = languageServerConfig.get('features');
	if (!enabled) {
		enabled = goConfig.get('languageServerExperimentalFeatures');
	}
	if (!enabled) {
		return;
	}

	let flags: string[] = languageServerConfig.get('flags');
	if (!flags) {
		flags = goConfig['languageServerFlags'] || [];
	}

	// The -trace was a flag was used by go-langserver, while gopls uses -rpc.trace.
	const toolName = getToolFromToolPath(toolPath);
	const traceFlagIndex = flags.indexOf('-trace');
	if (traceFlagIndex > -1 && toolName === 'gopls') {
		flags[traceFlagIndex] = '-rpc.trace';
	}

	const c = new LanguageClient(
		toolName,
		{
			command: toolPath,
			args: ['-mode=stdio', ...flags],
			options: {
				env: getToolsEnvVars()
			}
		},
		{
			initializationOptions: {
				funcSnippetEnabled: vscode.workspace.getConfiguration('go')['useCodeSnippetsOnFunctionSuggest'],
				gocodeCompletionEnabled: enabled['autoComplete'],
				incrementalSync: enabled['incrementalSync']
			},
			documentSelector: ['go', 'go.mod', 'go.sum'],
			uriConverters: {
				// Apply file:/// scheme to all file paths.
				code2Protocol: (uri: vscode.Uri): string => (uri.scheme ? uri : uri.with({ scheme: 'file' })).toString(),
				protocol2Code: (uri: string) => vscode.Uri.parse(uri),
			},
			revealOutputChannelOn: RevealOutputChannelOn.Never,
			middleware: {
				provideDocumentFormattingEdits: (document: vscode.TextDocument, options: FormattingOptions, token: vscode.CancellationToken, next: ProvideDocumentFormattingEditsSignature) => {
					if (!enabled['format']) {
						return [];
					}
					return next(document, options, token);
				},
				provideCompletionItem: async (document: vscode.TextDocument, position: vscode.Position, context: vscode.CompletionContext, token: vscode.CancellationToken, next: ProvideCompletionItemsSignature) => {
					if (!enabled['autoComplete']) {
						return [];
					}
					const promiseFromLanguageServer = Promise.resolve(next(document, position, context, token));
					const promiseWithoutGoCode = getCompletionsWithoutGoCode(document, position);
					const [resultFromLanguageServer, resultWithoutGoCode] = await Promise.all([promiseFromLanguageServer, promiseWithoutGoCode]);
					if (!resultWithoutGoCode || !resultWithoutGoCode.length) {
						return resultFromLanguageServer;
					}
					const completionItemsFromLanguageServer = Array.isArray(resultFromLanguageServer) ? resultFromLanguageServer : resultFromLanguageServer.items;
					resultWithoutGoCode.forEach(x => {
						if (x.kind !== vscode.CompletionItemKind.Module || !completionItemsFromLanguageServer.some(y => y.label === x.label)) {
							completionItemsFromLanguageServer.push(x);
						}
					});
					return resultFromLanguageServer;
				},
				provideRenameEdits: (document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken, next: ProvideRenameEditsSignature) => {
					if (!enabled['rename']) {
						return null;
					}
					return next(document, position, newName, token);
				},
				provideDefinition: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideDefinitionSignature) => {
					if (!enabled['goToDefinition']) {
						return null;
					}
					return next(document, position, token);
				},
				provideTypeDefinition: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideTypeDefinitionSignature) => {
					if (!enabled['goToTypeDefinition']) {
						return null;
					}
					return next(document, position, token);
				},
				provideHover: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideHoverSignature) => {
					if (!enabled['hover']) {
						return null;
					}
					return next(document, position, token);
				},
				provideReferences: (document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken, next: ProvideReferencesSignature) => {
					if (!enabled['findReferences']) {
						return [];
					}
					return next(document, position, options, token);
				},
				provideSignatureHelp: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideSignatureHelpSignature) => {
					if (!enabled['signatureHelp']) {
						return null;
					}
					return next(document, position, token);
				},
				provideDocumentSymbols: (document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentSymbolsSignature) => {
					if (!enabled['documentSymbols']) {
						return [];
					}
					return next(document, token);
				},
				provideWorkspaceSymbols: (query: string, token: vscode.CancellationToken, next: ProvideWorkspaceSymbolsSignature) => {
					if (!enabled['workspaceSymbols']) {
						return [];
					}
					return next(query, token);
				},
				provideImplementation: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideImplementationSignature) => {
					if (!enabled['goToImplementation']) {
						return null;
					}
					return next(document, position, token);
				},
				handleDiagnostics: (uri: vscode.Uri, diagnostics: vscode.Diagnostic[], next: HandleDiagnosticsSignature) => {
					if (!enabled['diagnostics']) {
						return null;
					}
					return next(uri, diagnostics);
				},
				provideDocumentLinks: (document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentLinksSignature) => {
					if (!enabled['documentLink']) {
						return null;
					}
					return next(document, token);
				}
			}
		}
	);

	c.onReady().then(() => {
		const capabilities = c.initializeResult && c.initializeResult.capabilities;
		if (!capabilities) {
			return vscode.window.showErrorMessage('The language server is not able to serve any features at the moment.');
		}
		// Fallback to default providers for unsupported or disabled features.

		if (!enabled['autoComplete'] || !capabilities.completionProvider) {
			const provider = new GoCompletionItemProvider(ctx.globalState);
			ctx.subscriptions.push(provider);
			ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider(GO_MODE, provider, '.', '\"'));
		}

		if (!enabled['format'] || !capabilities.documentFormattingProvider) {
			ctx.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider()));
		}

		if (!enabled['rename'] || !capabilities.renameProvider) {
			ctx.subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));
		}

		if (!enabled['goToTypeDefinition'] || !capabilities.typeDefinitionProvider) {
			ctx.subscriptions.push(vscode.languages.registerTypeDefinitionProvider(GO_MODE, new GoTypeDefinitionProvider()));
		}

		if (!enabled['hover'] || !capabilities.hoverProvider) {
			ctx.subscriptions.push(vscode.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
		}

		if (!enabled['goToDefinition'] || !capabilities.definitionProvider) {
			ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
		}

		if (!enabled['findReferences'] || !capabilities.referencesProvider) {
			ctx.subscriptions.push(vscode.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
		}

		if (!enabled['documentSymbols'] || !capabilities.documentSymbolProvider) {
			ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSymbolProvider()));
		}

		if (!enabled['signatureHelp'] || !capabilities.signatureHelpProvider) {
			ctx.subscriptions.push(vscode.languages.registerSignatureHelpProvider(GO_MODE, new GoSignatureHelpProvider(), '(', ','));
		}

		if (!enabled['workspaceSymbols'] || !capabilities.workspaceSymbolProvider) {
			ctx.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new GoWorkspaceSymbolProvider()));
		}

		if (!enabled['goToImplementation'] || !capabilities.implementationProvider) {
			ctx.subscriptions.push(vscode.languages.registerImplementationProvider(GO_MODE, new GoImplementationProvider()));
		}
	});

	let languageServerDisposable = c.start();
	ctx.subscriptions.push(languageServerDisposable);

	ctx.subscriptions.push(vscode.commands.registerCommand('go.languageserver.restart', async () => {
		await c.stop();
		languageServerDisposable.dispose();
		languageServerDisposable = c.start();
		ctx.subscriptions.push(languageServerDisposable);
	}));

	// gopls is the only language server that provides live diagnostics on type,
	// so use gotype otherwise.
	if (!(toolName === 'gopls' && enabled['diagnostics'])) {
		vscode.workspace.onDidChangeTextDocument(parseLiveFile, null, ctx.subscriptions);
	}
}