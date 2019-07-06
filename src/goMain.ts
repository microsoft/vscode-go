/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { GoCompletionItemProvider, getCompletionsWithoutGoCode } from './goSuggest';
import { GoHoverProvider } from './goExtraInfo';
import { GoDefinitionProvider } from './goDeclaration';
import { GoReferenceProvider } from './goReferences';
import { GoImplementationProvider } from './goImplementations';
import { GoTypeDefinitionProvider } from './goTypeDefinition';
import { GoDocumentFormattingEditProvider } from './goFormat';
import { GoRenameProvider } from './goRename';
import { GoDocumentSymbolProvider } from './goOutline';
import { GoRunTestCodeLensProvider } from './goRunTestCodelens';
import { GoSignatureHelpProvider } from './goSignature';
import { GoWorkspaceSymbolProvider } from './goSymbol';
import { GoCodeActionProvider } from './goCodeAction';
import { check, removeTestStatus, notifyIfGeneratedFile } from './goCheck';
import { updateGoPathGoRootFromConfig, offerToInstallTools, promptForMissingTool, installTools } from './goInstallTools';
import { GO_MODE } from './goMode';
import { showHideStatus } from './goStatus';
import { initCoverageDecorators, toggleCoverageCurrentPackage, applyCodeCoverage, removeCodeCoverageOnFileChange, updateCodeCoverageDecorators } from './goCover';
import { testAtCursor, testCurrentPackage, testCurrentFile, testPrevious, testWorkspace } from './goTest';
import { showTestOutput, cancelRunningTests } from './testUtils';
import * as goGenerateTests from './goGenerateTests';
import { addImport, addImportToWorkspace } from './goImport';
import { installAllTools, getLanguageServerToolPath } from './goInstallTools';
import {
	isGoPathSet, getBinPath, sendTelemetryEvent, getExtensionCommands, getGoVersion, getCurrentGoPath,
	getToolsGopath, handleDiagnosticErrors, disposeTelemetryReporter, getToolsEnvVars, cleanupTempDir
} from './util';
import {
	LanguageClient, RevealOutputChannelOn, FormattingOptions, ProvideDocumentFormattingEditsSignature,
	ProvideCompletionItemsSignature, ProvideRenameEditsSignature, ProvideDefinitionSignature, ProvideHoverSignature,
	ProvideReferencesSignature, ProvideSignatureHelpSignature, ProvideDocumentSymbolsSignature, ProvideWorkspaceSymbolsSignature,
	HandleDiagnosticsSignature, ProvideDocumentLinksSignature,
} from 'vscode-languageclient';
import { clearCacheForTools, fixDriveCasingInWindows, getToolFromToolPath } from './goPath';
import { addTags, removeTags } from './goModifytags';
import { runFillStruct } from './goFillStruct';
import { parseLiveFile } from './goLiveErrors';
import { GoReferencesCodeLensProvider } from './goReferencesCodelens';
import { implCursor } from './goImpl';
import { extractFunction, extractVariable } from './goDoctor';
import { browsePackages } from './goBrowsePackage';
import { goGetPackage } from './goGetPackage';
import { GoDebugConfigurationProvider } from './goDebugConfiguration';
import { playgroundCommand } from './goPlayground';
import { lintCode } from './goLint';
import { vetCode } from './goVet';
import { buildCode } from './goBuild';
import { installCurrentPackage } from './goInstall';
import { setGlobalState } from './stateUtils';
import { ProvideTypeDefinitionSignature } from 'vscode-languageclient/lib/typeDefinition';
import { ProvideImplementationSignature } from 'vscode-languageclient/lib/implementation';

export let buildDiagnosticCollection: vscode.DiagnosticCollection;
export let lintDiagnosticCollection: vscode.DiagnosticCollection;
export let vetDiagnosticCollection: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext): void {
	setGlobalState(ctx.globalState);

	updateGoPathGoRootFromConfig().then(async () => {
		const updateToolsCmdText = 'Update tools';
		interface GoInfo {
			goroot: string;
			version: string;
		}
		const toolsGoInfo: { [id: string]: GoInfo; } = ctx.globalState.get('toolsGoInfo') || {};
		const toolsGopath = getToolsGopath() || getCurrentGoPath();
		if (!toolsGoInfo[toolsGopath]) {
			toolsGoInfo[toolsGopath] = { goroot: null, version: null };
		}
		const prevGoroot = toolsGoInfo[toolsGopath].goroot;
		const currentGoroot: string = process.env['GOROOT'] && process.env['GOROOT'].toLowerCase();
		if (prevGoroot && prevGoroot.toLowerCase() !== currentGoroot) {
			vscode.window.showInformationMessage(`Your current goroot (${currentGoroot}) is different than before (${prevGoroot}), a few Go tools may need recompiling`, updateToolsCmdText).then(selected => {
				if (selected === updateToolsCmdText) {
					installAllTools(true);
				}
			});
		} else {
			const currentVersion = await getGoVersion();
			if (currentVersion) {
				const prevVersion = toolsGoInfo[toolsGopath].version;
				const currVersionString = `${currentVersion.major}.${currentVersion.minor}`;

				if (prevVersion !== currVersionString) {
					if (prevVersion) {
						vscode.window.showInformationMessage('Your Go version is different than before, few Go tools may need re-compiling', updateToolsCmdText).then(selected => {
							if (selected === updateToolsCmdText) {
								installAllTools(true);
							}
						});
					}
					toolsGoInfo[toolsGopath].version = currVersionString;
				}
			}
		}
		toolsGoInfo[toolsGopath].goroot = currentGoroot;
		ctx.globalState.update('toolsGoInfo', toolsGoInfo);

		offerToInstallTools();
		const languageServerToolPath = getLanguageServerToolPath();
		if (languageServerToolPath) {
			const languageServerTool = getToolFromToolPath(languageServerToolPath);
			const languageServerExperimentalFeatures: any = vscode.workspace.getConfiguration('go').get('languageServerExperimentalFeatures') || {};
			const langServerFlags: string[] = vscode.workspace.getConfiguration('go')['languageServerFlags'] || [];

			// `-trace was a flag for `go-langserver` which is replaced with `-rpc.trace` for gopls to avoid crash
			const traceFlagIndex = langServerFlags.indexOf('-trace');
			if (traceFlagIndex > -1 && languageServerTool === 'gopls') {
				langServerFlags[traceFlagIndex] = '-rpc.trace';
			}

			const c = new LanguageClient(
				languageServerTool,
				{
					command: languageServerToolPath,
					args: ['-mode=stdio', ...langServerFlags],
					options: {
						env: getToolsEnvVars()
					}
				},
				{
					initializationOptions: {
						funcSnippetEnabled: vscode.workspace.getConfiguration('go')['useCodeSnippetsOnFunctionSuggest'],
						gocodeCompletionEnabled: languageServerExperimentalFeatures['autoComplete'],
						incrementalSync: languageServerExperimentalFeatures['incrementalSync']
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
							if (languageServerExperimentalFeatures['format'] === true) {
								return next(document, options, token);
							}
							return [];
						},
						provideCompletionItem: async (document: vscode.TextDocument, position: vscode.Position, context: vscode.CompletionContext, token: vscode.CancellationToken, next: ProvideCompletionItemsSignature) => {
							if (languageServerExperimentalFeatures['autoComplete'] === true) {
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
							}
							return [];
						},
						provideRenameEdits: (document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken, next: ProvideRenameEditsSignature) => {
							if (languageServerExperimentalFeatures['rename'] === true) {
								return next(document, position, newName, token);
							}
							return null;
						},
						provideDefinition: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideDefinitionSignature) => {
							if (languageServerExperimentalFeatures['goToDefinition'] === true) {
								return next(document, position, token);
							}
							return null;
						},
						provideTypeDefinition: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideTypeDefinitionSignature) => {
							if (languageServerExperimentalFeatures['goToTypeDefinition'] === true) {
								return next(document, position, token);
							}
							return null;
						},
						provideHover: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideHoverSignature) => {
							if (languageServerExperimentalFeatures['hover'] === true) {
								return next(document, position, token);
							}
							return null;
						},
						provideReferences: (document: vscode.TextDocument, position: vscode.Position, options: { includeDeclaration: boolean }, token: vscode.CancellationToken, next: ProvideReferencesSignature) => {
							if (languageServerExperimentalFeatures['findReferences'] === true) {
								return next(document, position, options, token);
							}
							return [];
						},
						provideSignatureHelp: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideSignatureHelpSignature) => {
							if (languageServerExperimentalFeatures['signatureHelp'] === true) {
								return next(document, position, token);
							}
							return null;
						},
						provideDocumentSymbols: (document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentSymbolsSignature) => {
							if (languageServerExperimentalFeatures['documentSymbols'] === true) {
								return next(document, token);
							}
							return [];
						},
						provideWorkspaceSymbols: (query: string, token: vscode.CancellationToken, next: ProvideWorkspaceSymbolsSignature) => {
							if (languageServerExperimentalFeatures['workspaceSymbols'] === true) {
								return next(query, token);
							}
							return [];
						},
						provideImplementation: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, next: ProvideImplementationSignature) => {
							if (languageServerExperimentalFeatures['goToImplementation'] === true) {
								return next(document, position, token);
							}
							return null;
						},
						handleDiagnostics: (uri: vscode.Uri, diagnostics: vscode.Diagnostic[], next: HandleDiagnosticsSignature) => {
							if (languageServerExperimentalFeatures['diagnostics'] === true) {
								return next(uri, diagnostics);
							}
							return null;
						},
						provideDocumentLinks: (document: vscode.TextDocument, token: vscode.CancellationToken, next: ProvideDocumentLinksSignature) => {
							if (languageServerExperimentalFeatures['documentLink'] === true) {
								return next(document, token);
							}
							return null;
						}
					}
				}
			);

			c.onReady().then(() => {
				const capabilities = c.initializeResult && c.initializeResult.capabilities;
				if (!capabilities) {
					return vscode.window.showErrorMessage('The language server is not able to serve any features at the moment.');
				}

				if (languageServerExperimentalFeatures['autoComplete'] !== true || !capabilities.completionProvider) {
					registerCompletionProvider(ctx);
				}

				if (languageServerExperimentalFeatures['format'] !== true || !capabilities.documentFormattingProvider) {
					ctx.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider()));
				}

				if (languageServerExperimentalFeatures['rename'] !== true || !capabilities.renameProvider) {
					ctx.subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));
				}

				if (languageServerExperimentalFeatures['goToTypeDefinition'] !== true || !capabilities.typeDefinitionProvider) {
					ctx.subscriptions.push(vscode.languages.registerTypeDefinitionProvider(GO_MODE, new GoTypeDefinitionProvider()));
				}

				if (languageServerExperimentalFeatures['hover'] !== true || !capabilities.hoverProvider) {
					ctx.subscriptions.push(vscode.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
				}

				if (languageServerExperimentalFeatures['goToDefinition'] !== true || !capabilities.definitionProvider) {
					ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
				}

				if (languageServerExperimentalFeatures['findReferences'] !== true || !capabilities.referencesProvider) {
					ctx.subscriptions.push(vscode.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
				}

				if (languageServerExperimentalFeatures['documentSymbols'] !== true || !capabilities.documentSymbolProvider) {
					ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSymbolProvider()));
				}

				if (languageServerExperimentalFeatures['signatureHelp'] !== true || !capabilities.signatureHelpProvider) {
					ctx.subscriptions.push(vscode.languages.registerSignatureHelpProvider(GO_MODE, new GoSignatureHelpProvider(), '(', ','));
				}

				if (languageServerExperimentalFeatures['workspaceSymbols'] !== true || !capabilities.workspaceSymbolProvider) {
					ctx.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new GoWorkspaceSymbolProvider()));
				}

				if (languageServerExperimentalFeatures['goToImplementation'] !== true || !capabilities.implementationProvider) {
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

			if (languageServerTool !== 'gopls' || !languageServerExperimentalFeatures['diagnostics']) {
				vscode.workspace.onDidChangeTextDocument(parseLiveFile, null, ctx.subscriptions);
			}
		} else {
			registerCompletionProvider(ctx);
			ctx.subscriptions.push(vscode.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
			ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
			ctx.subscriptions.push(vscode.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
			ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSymbolProvider()));
			ctx.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new GoWorkspaceSymbolProvider()));
			ctx.subscriptions.push(vscode.languages.registerSignatureHelpProvider(GO_MODE, new GoSignatureHelpProvider(), '(', ','));
			ctx.subscriptions.push(vscode.languages.registerImplementationProvider(GO_MODE, new GoImplementationProvider()));
			ctx.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider()));
			ctx.subscriptions.push(vscode.languages.registerTypeDefinitionProvider(GO_MODE, new GoTypeDefinitionProvider()));
			ctx.subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));
			vscode.workspace.onDidChangeTextDocument(parseLiveFile, null, ctx.subscriptions);
		}

		if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'go' && isGoPathSet()) {
			runBuilds(vscode.window.activeTextEditor.document, vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor.document.uri));
		}
	});

	initCoverageDecorators(ctx);

	const testCodeLensProvider = new GoRunTestCodeLensProvider();
	const referencesCodeLensProvider = new GoReferencesCodeLensProvider();

	ctx.subscriptions.push(vscode.languages.registerCodeActionsProvider(GO_MODE, new GoCodeActionProvider()));
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider(GO_MODE, testCodeLensProvider));
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider(GO_MODE, referencesCodeLensProvider));
	ctx.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('go', new GoDebugConfigurationProvider()));

	buildDiagnosticCollection = vscode.languages.createDiagnosticCollection('go');
	ctx.subscriptions.push(buildDiagnosticCollection);
	lintDiagnosticCollection = vscode.languages.createDiagnosticCollection('go-lint');
	ctx.subscriptions.push(lintDiagnosticCollection);
	vetDiagnosticCollection = vscode.languages.createDiagnosticCollection('go-vet');
	ctx.subscriptions.push(vetDiagnosticCollection);

	addOnChangeTextDocumentListeners(ctx);
	addOnChangeActiveTextEditorListeners(ctx);
	addOnSaveTextDocumentListeners(ctx);

	ctx.subscriptions.push(vscode.commands.registerCommand('go.gopath', () => {
		const gopath = getCurrentGoPath();
		let msg = `${gopath} is the current GOPATH.`;
		const wasInfered = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null)['inferGopath'];
		let root = vscode.workspace.rootPath;
		if (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) {
			root = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri.fsPath;
			root = fixDriveCasingInWindows(root);
		}

		// not only if it was configured, but if it was successful.
		if (wasInfered && root && root.indexOf(gopath) === 0) {
			const inferredFrom = vscode.window.activeTextEditor ? 'current folder' : 'workspace root';
			msg += ` It is inferred from ${inferredFrom}`;
		}

		vscode.window.showInformationMessage(msg);
		return gopath;
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.add.tags', (args) => {
		addTags(args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.remove.tags', (args) => {
		removeTags(args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.fill.struct', () => {
		runFillStruct(vscode.window.activeTextEditor);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.impl.cursor', () => {
		implCursor();
	}));
	ctx.subscriptions.push(vscode.commands.registerCommand('go.godoctor.extract', () => {
		extractFunction();
	}));
	ctx.subscriptions.push(vscode.commands.registerCommand('go.godoctor.var', () => {
		extractVariable();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.cursor', (args) => {
		const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		testAtCursor(goConfig, 'test', args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.debug.cursor', (args) => {
		const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		testAtCursor(goConfig, 'debug', args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.benchmark.cursor', (args) => {
		const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		testAtCursor(goConfig, 'benchmark', args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.package', (args) => {
		const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		const isBenchmark = false;
		testCurrentPackage(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.benchmark.package', (args) => {
		const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		const isBenchmark = true;
		testCurrentPackage(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.file', (args) => {
		const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		const isBenchmark = false;
		testCurrentFile(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.benchmark.file', (args) => {
		const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		const isBenchmark = true;
		testCurrentFile(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.workspace', (args) => {
		const goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		testWorkspace(goConfig, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.previous', () => {
		testPrevious();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.coverage', () => {
		toggleCoverageCurrentPackage();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.showOutput', () => {
		showTestOutput();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.cancel', () => {
		cancelRunningTests();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.import.add', (arg) => {
		return addImport(arg);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.add.package.workspace', () => {
		addImportToWorkspace();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.tools.install', (args) => {
		if (Array.isArray(args) && args.length) {
			getGoVersion().then(goVersion => {
				installTools(args, goVersion);
			});
			return;
		}
		installAllTools();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.browse.packages', () => {
		browsePackages();
	}));

	ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
		if (!e.affectsConfiguration('go')) {
			return;
		}
		const updatedGoConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		sendTelemetryEventForConfig(updatedGoConfig);
		updateGoPathGoRootFromConfig();

		// If there was a change in "toolsGopath" setting, then clear cache for go tools
		if (getToolsGopath() !== getToolsGopath(false)) {
			clearCacheForTools();
		}

		const languageServerToolPathBeingUsed = getLanguageServerToolPath();
		let reloadMessage: string;
		if (e.affectsConfiguration('go.useLanguageServer')) {
			if (updatedGoConfig['useLanguageServer']) {
				if (languageServerToolPathBeingUsed) {
					reloadMessage = 'Reload VS Code window to enable the use of language server';
				}
			} else {
				reloadMessage = 'Reload VS Code window to disable the use of language server';
			}
		} else if (e.affectsConfiguration('go.languageServerFlags') || e.affectsConfiguration('go.languageServerExperimentalFeatures')) {
			reloadMessage = 'Reload VS Code window for the changes in language server settings to take effect';
		}

		// If there was a change in "useLanguageServer" setting, then ask the user to reload VS Code.
		if (reloadMessage) {
			vscode.window.showInformationMessage(reloadMessage, 'Reload').then(selected => {
				if (selected === 'Reload') {
					vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			});
		}

		if (updatedGoConfig['enableCodeLens']) {
			testCodeLensProvider.setEnabled(updatedGoConfig['enableCodeLens']['runtest']);
			referencesCodeLensProvider.setEnabled(updatedGoConfig['enableCodeLens']['references']);
		}

		const languageServerExperimentalFeatures: any = updatedGoConfig.get('languageServerExperimentalFeatures');
		if (e.affectsConfiguration('go.formatTool') && (!languageServerToolPathBeingUsed || languageServerExperimentalFeatures['format'] === false)) {
			checkToolExists(updatedGoConfig['formatTool']);
		}
		if (e.affectsConfiguration('go.lintTool')) {
			checkToolExists(updatedGoConfig['lintTool']);
		}
		if (e.affectsConfiguration('go.docsTool')) {
			checkToolExists(updatedGoConfig['docsTool']);
		}
		if (e.affectsConfiguration('go.coverageDecorator')) {
			updateCodeCoverageDecorators(updatedGoConfig['coverageDecorator']);
		}
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.generate.package', () => {
		goGenerateTests.generateTestCurrentPackage();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.generate.file', () => {
		goGenerateTests.generateTestCurrentFile();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.generate.function', () => {
		goGenerateTests.generateTestCurrentFunction();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.toggle.test.file', () => {
		goGenerateTests.toggleTestFile();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.debug.startSession', config => {
		let workspaceFolder;
		if (vscode.window.activeTextEditor) {
			workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
		}

		return vscode.debug.startDebugging(workspaceFolder, config);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.show.commands', () => {
		const extCommands = getExtensionCommands();
		extCommands.push({
			command: 'editor.action.goToDeclaration',
			title: 'Go to Definition'
		});
		extCommands.push({
			command: 'editor.action.goToImplementation',
			title: 'Go to Implementation'
		});
		extCommands.push({
			command: 'workbench.action.gotoSymbol',
			title: 'Go to Symbol in File...'
		});
		extCommands.push({
			command: 'workbench.action.showAllSymbols',
			title: 'Go to Symbol in Workspace...'
		});
		vscode.window.showQuickPick(extCommands.map(x => x.title)).then(cmd => {
			const selectedCmd = extCommands.find(x => x.title === cmd);
			if (selectedCmd) {
				vscode.commands.executeCommand(selectedCmd.command);
			}
		});
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.get.package', goGetPackage));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.playground', playgroundCommand));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.lint.package', () => lintCode('package')));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.lint.workspace', () => lintCode('workspace')));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.lint.file', () => lintCode('file')));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.vet.package', vetCode));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.vet.workspace', () => vetCode(true)));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.build.package', buildCode));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.build.workspace', () => buildCode(true)));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.install.package', installCurrentPackage));

	vscode.languages.setLanguageConfiguration(GO_MODE.language, {
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
	});

	sendTelemetryEventForConfig(vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null));
}

export function deactivate() {
	return Promise.all([disposeTelemetryReporter(), cancelRunningTests(), Promise.resolve(cleanupTempDir())]);
}

function runBuilds(document: vscode.TextDocument, goConfig: vscode.WorkspaceConfiguration) {
	if (document.languageId !== 'go') {
		return;
	}

	buildDiagnosticCollection.clear();
	lintDiagnosticCollection.clear();
	vetDiagnosticCollection.clear();
	check(document.uri, goConfig)
		.then(results => {
			results.forEach(result => {
				handleDiagnosticErrors(document, result.errors, result.diagnosticCollection);
			});
		})
		.catch(err => {
			vscode.window.showInformationMessage('Error: ' + err);
		});
}

function addOnSaveTextDocumentListeners(ctx: vscode.ExtensionContext) {
	vscode.workspace.onDidSaveTextDocument(document => {
		if (document.languageId !== 'go') {
			return;
		}
		if (vscode.window.visibleTextEditors.some(e => e.document.fileName === document.fileName)) {
			runBuilds(document, vscode.workspace.getConfiguration('go', document.uri));
		}

	}, null, ctx.subscriptions);
}

function addOnChangeTextDocumentListeners(ctx: vscode.ExtensionContext) {
	vscode.workspace.onDidChangeTextDocument(removeCodeCoverageOnFileChange, null, ctx.subscriptions);
	vscode.workspace.onDidChangeTextDocument(removeTestStatus, null, ctx.subscriptions);
	vscode.workspace.onDidChangeTextDocument(notifyIfGeneratedFile, ctx, ctx.subscriptions);
}

function addOnChangeActiveTextEditorListeners(ctx: vscode.ExtensionContext) {
	vscode.window.onDidChangeActiveTextEditor(showHideStatus, null, ctx.subscriptions);
	vscode.window.onDidChangeActiveTextEditor(applyCodeCoverage, null, ctx.subscriptions);
}

function sendTelemetryEventForConfig(goConfig: vscode.WorkspaceConfiguration) {
	/* __GDPR__
	   "goConfig" : {
		  "buildOnSave" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "buildFlags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "buildTags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "formatTool": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "formatFlags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "generateTestsFlags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "lintOnSave": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "lintFlags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "lintTool": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "vetOnSave": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "vetFlags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "testOnSave": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "testFlags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "coverOnSave": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "coverOnTestPackage": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "coverageDecorator": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "coverageOptions": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "gopath": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "goroot": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "inferGopath": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "toolsGopath": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "gocodeAutoBuild": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "gocodePackageLookupMode": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "useCodeSnippetsOnFunctionSuggest": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "useCodeSnippetsOnFunctionSuggestWithoutType": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "autocompleteUnimportedPackages": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "docsTool": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "useLanguageServer": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "includeImports": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "addTags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "removeTags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "editorContextMenuCommands": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "liveErrors": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "codeLens": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "alternateTools": { "classification": "CustomerContent", "purpose": "FeatureInsight" }
	   }
	 */
	sendTelemetryEvent('goConfig', {
		buildOnSave: goConfig['buildOnSave'] + '',
		buildFlags: goConfig['buildFlags'],
		buildTags: goConfig['buildTags'],
		formatOnSave: goConfig['formatOnSave'] + '',
		formatTool: goConfig['formatTool'],
		formatFlags: goConfig['formatFlags'],
		lintOnSave: goConfig['lintOnSave'] + '',
		lintFlags: goConfig['lintFlags'],
		lintTool: goConfig['lintTool'],
		generateTestsFlags: goConfig['generateTestsFlags'],
		vetOnSave: goConfig['vetOnSave'] + '',
		vetFlags: goConfig['vetFlags'],
		testOnSave: goConfig['testOnSave'] + '',
		testFlags: goConfig['testFlags'],
		coverOnSave: goConfig['coverOnSave'] + '',
		coverOnTestPackage: goConfig['coverOnTestPackage'] + '',
		coverageDecorator: goConfig['coverageDecorator'],
		coverageOptions: goConfig['coverageOptions'],
		gopath: goConfig['gopath'] ? 'set' : '',
		goroot: goConfig['goroot'] ? 'set' : '',
		inferGopath: goConfig['inferGopath'] + '',
		toolsGopath: goConfig['toolsGopath'] ? 'set' : '',
		gocodeAutoBuild: goConfig['gocodeAutoBuild'] + '',
		gocodePackageLookupMode: goConfig['gocodePackageLookupMode'] + '',
		useCodeSnippetsOnFunctionSuggest: goConfig['useCodeSnippetsOnFunctionSuggest'] + '',
		useCodeSnippetsOnFunctionSuggestWithoutType: goConfig['useCodeSnippetsOnFunctionSuggestWithoutType'] + '',
		autocompleteUnimportedPackages: goConfig['autocompleteUnimportedPackages'] + '',
		docsTool: goConfig['docsTool'],
		useLanguageServer: goConfig['useLanguageServer'] + '',
		languageServerExperimentalFeatures: JSON.stringify(goConfig['languageServerExperimentalFeatures']),
		includeImports: goConfig['gotoSymbol'] && goConfig['gotoSymbol']['includeImports'] + '',
		addTags: JSON.stringify(goConfig['addTags']),
		removeTags: JSON.stringify(goConfig['removeTags']),
		editorContextMenuCommands: JSON.stringify(goConfig['editorContextMenuCommands']),
		liveErrors: JSON.stringify(goConfig['liveErrors']),
		codeLens: JSON.stringify(goConfig['enableCodeLens']),
		alternateTools: JSON.stringify(goConfig['alternateTools'])
	});
}

function checkToolExists(tool: string) {
	if (tool === getBinPath(tool)) {
		promptForMissingTool(tool);
	}
}

function registerCompletionProvider(ctx: vscode.ExtensionContext) {
	const provider = new GoCompletionItemProvider(ctx.globalState);
	ctx.subscriptions.push(provider);
	ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider(GO_MODE, provider, '.', '\"'));
}
