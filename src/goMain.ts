/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { GoCompletionItemProvider } from './goSuggest';
import { GoHoverProvider } from './goExtraInfo';
import { GoDefinitionProvider } from './goDeclaration';
import { GoReferenceProvider } from './goReferences';
import { GoImplementationProvider } from './goImplementations';
import { GoDocumentFormattingEditProvider } from './goFormat';
import { GoRenameProvider } from './goRename';
import { GoDocumentSymbolProvider } from './goOutline';
import { GoRunTestCodeLensProvider } from './goRunTestCodelens';
import { GoSignatureHelpProvider } from './goSignature';
import { GoWorkspaceSymbolProvider } from './goSymbol';
import { GoCodeActionProvider } from './goCodeAction';
import { check, removeTestStatus, notifyIfGeneratedFile } from './goCheck';
import { updateGoPathGoRootFromConfig, offerToInstallTools } from './goInstallTools';
import { GO_MODE } from './goMode';
import { showHideStatus } from './goStatus';
import { toggleCoverageCurrentPackage, getCodeCoverage, removeCodeCoverage } from './goCover';
import { initGoCover } from './goCover';
import { testAtCursor, testCurrentPackage, testCurrentFile, testPrevious, testWorkspace } from './goTest';
import { showTestOutput } from './testUtils';
import * as goGenerateTests from './goGenerateTests';
import { addImport } from './goImport';
import { getAllPackages } from './goPackages';
import { installAllTools, checkLanguageServer } from './goInstallTools';
import { isGoPathSet, getBinPath, sendTelemetryEvent, getExtensionCommands, getGoVersion, getCurrentGoPath, getToolsGopath, handleDiagnosticErrors, disposeTelemetryReporter, getToolsEnvVars } from './util';
import { LanguageClient, RevealOutputChannelOn } from 'vscode-languageclient';
import { clearCacheForTools, fixDriveCasingInWindows } from './goPath';
import { addTags, removeTags } from './goModifytags';
import { runFillStruct } from './goFillStruct';
import { parseLiveFile } from './goLiveErrors';
import { GoReferencesCodeLensProvider } from './goReferencesCodelens';
import { implCursor } from './goImpl';
import { browsePackages } from './goBrowsePackage';
import { goGetPackage } from './goGetPackage';
import { GoDebugConfigurationProvider } from './goDebugConfiguration';
import { playgroundCommand } from './goPlayground';
import { lintCode } from './goLint';
import { vetCode } from './goVet';
import { buildCode } from './goBuild';
import { installCurrentPackage } from './goInstall';

export let errorDiagnosticCollection: vscode.DiagnosticCollection;
export let warningDiagnosticCollection: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext): void {

	let useLangServer = vscode.workspace.getConfiguration('go')['useLanguageServer'];
	let langServerFlags: string[] = vscode.workspace.getConfiguration('go')['languageServerFlags'] || [];

	updateGoPathGoRootFromConfig().then(() => {
		const updateToolsCmdText = 'Update tools';
		const prevGoroot = ctx.globalState.get('goroot');
		const currentGoroot = process.env['GOROOT'];
		if (prevGoroot !== currentGoroot && prevGoroot) {
			vscode.window.showInformationMessage('Your goroot is different than before, few Go tools may need re-compiling', updateToolsCmdText).then(selected => {
				if (selected === updateToolsCmdText) {
					vscode.commands.executeCommand('go.tools.install');
				}
			});
		} else {
			getGoVersion().then(currentVersion => {
				if (currentVersion) {
					const prevVersion = ctx.globalState.get('goVersion');
					const currVersionString = `${currentVersion.major}.${currentVersion.minor}`;

					if (prevVersion !== currVersionString) {
						if (prevVersion) {
							vscode.window.showInformationMessage('Your Go version is different than before, few Go tools may need re-compiling', updateToolsCmdText).then(selected => {
								if (selected === updateToolsCmdText) {
									vscode.commands.executeCommand('go.tools.install');
								}
							});
						}
						ctx.globalState.update('goVersion', currVersionString);
					}
				}
			});
		}
		ctx.globalState.update('goroot', currentGoroot);

		offerToInstallTools();
		let langServerAvailable = checkLanguageServer();
		if (langServerAvailable) {
			let langServerFlags: string[] = vscode.workspace.getConfiguration('go')['languageServerFlags'] || [];
			const c = new LanguageClient(
				'go-langserver',
				{
					command: getBinPath('go-langserver'),
					args: ['-mode=stdio', ...langServerFlags],
					options: {
						env: getToolsEnvVars()
					}
				},
				{
					documentSelector: ['go'],
					uriConverters: {
						// Apply file:/// scheme to all file paths.
						code2Protocol: (uri: vscode.Uri): string => (uri.scheme ? uri : uri.with({ scheme: 'file' })).toString(),
						protocol2Code: (uri: string) => vscode.Uri.parse(uri),
					},
					revealOutputChannelOn: RevealOutputChannelOn.Never
				}
			);

			ctx.subscriptions.push(c.start());
		} else {
			ctx.subscriptions.push(vscode.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
			ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
			ctx.subscriptions.push(vscode.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
			ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSymbolProvider()));
			ctx.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new GoWorkspaceSymbolProvider()));
			ctx.subscriptions.push(vscode.languages.registerSignatureHelpProvider(GO_MODE, new GoSignatureHelpProvider(), '(', ','));
			ctx.subscriptions.push(vscode.languages.registerImplementationProvider(GO_MODE, new GoImplementationProvider()));
		}

		if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'go' && isGoPathSet()) {
			// preload packages so the cache are ready to use
			loadPackages();
			runBuilds(vscode.window.activeTextEditor.document, vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor.document.uri));
		}
	});

	initGoCover(ctx);

	let testCodeLensProvider = new GoRunTestCodeLensProvider();
	let referencesCodeLensProvider = new GoReferencesCodeLensProvider();

	ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider(GO_MODE, new GoCompletionItemProvider(), '.', '\"'));
	ctx.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider()));
	ctx.subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));
	ctx.subscriptions.push(vscode.languages.registerCodeActionsProvider(GO_MODE, new GoCodeActionProvider()));
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider(GO_MODE, testCodeLensProvider));
	ctx.subscriptions.push(vscode.languages.registerCodeLensProvider(GO_MODE, referencesCodeLensProvider));
	ctx.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('go', new GoDebugConfigurationProvider()));

	errorDiagnosticCollection = vscode.languages.createDiagnosticCollection('go-error');
	ctx.subscriptions.push(errorDiagnosticCollection);
	warningDiagnosticCollection = vscode.languages.createDiagnosticCollection('go-warning');
	ctx.subscriptions.push(warningDiagnosticCollection);
	vscode.workspace.onDidChangeTextDocument(removeCodeCoverage, null, ctx.subscriptions);
	vscode.workspace.onDidChangeTextDocument(removeTestStatus, null, ctx.subscriptions);
	vscode.window.onDidChangeActiveTextEditor(showHideStatus, null, ctx.subscriptions);
	vscode.window.onDidChangeActiveTextEditor(getCodeCoverage, null, ctx.subscriptions);
	vscode.workspace.onDidChangeTextDocument(parseLiveFile, null, ctx.subscriptions);
	vscode.workspace.onDidChangeTextDocument(notifyIfGeneratedFile, ctx, ctx.subscriptions);

	startBuildOnSaveWatcher(ctx.subscriptions);

	ctx.subscriptions.push(vscode.commands.registerCommand('go.gopath', () => {
		let gopath = getCurrentGoPath();

		let wasInfered = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null)['inferGopath'];
		let root = vscode.workspace.rootPath;
		if (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) {
			root = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri.fsPath;
			root = fixDriveCasingInWindows(root);
		}

		// not only if it was configured, but if it was successful.
		if (wasInfered && root && root.indexOf(gopath) === 0) {
			const inferredFrom = vscode.window.activeTextEditor ? 'current folder' : 'workspace root';
			vscode.window.showInformationMessage(`Current GOPATH is inferred from ${inferredFrom}: ${gopath}`);
		} else {
			vscode.window.showInformationMessage('Current GOPATH: ' + gopath);
		}
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

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.cursor', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		let isBenchmark = false;
		testAtCursor(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.benchmark.cursor', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		let isBenchmark = true;
		testAtCursor(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.package', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		testCurrentPackage(goConfig, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.file', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		testCurrentFile(goConfig, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.workspace', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
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

	ctx.subscriptions.push(vscode.commands.registerCommand('go.import.add', (arg: string) => {
		return addImport(typeof arg === 'string' ? arg : null);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.tools.install', () => {
		installAllTools();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.browse.packages', () => {
		browsePackages();
	}));

	ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
		let updatedGoConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
		sendTelemetryEventForConfig(updatedGoConfig);
		updateGoPathGoRootFromConfig();

		// If there was a change in "useLanguageServer" setting, then ask the user to reload VS Code.
		if (process.platform !== 'win32'
			&& didLangServerConfigChange(useLangServer, langServerFlags, updatedGoConfig)
			&& (!updatedGoConfig['useLanguageServer'] || checkLanguageServer())) {
			vscode.window.showInformationMessage('Reload VS Code window for the change in usage of language server to take effect', 'Reload').then(selected => {
				if (selected === 'Reload') {
					vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			});
		}
		useLangServer = updatedGoConfig['useLanguageServer'];

		// If there was a change in "toolsGopath" setting, then clear cache for go tools
		if (getToolsGopath() !== getToolsGopath(false)) {
			clearCacheForTools();
		}

		if (updatedGoConfig['enableCodeLens']) {
			testCodeLensProvider.setEnabled(updatedGoConfig['enableCodeLens']['runtest']);
			referencesCodeLensProvider.setEnabled(updatedGoConfig['enableCodeLens']['references']);
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
		vscode.window.showQuickPick(getExtensionCommands().map(x => x.title)).then(cmd => {
			let selectedCmd = getExtensionCommands().find(x => x.title === cmd);
			if (selectedCmd) {
				vscode.commands.executeCommand(selectedCmd.command);
			}
		});
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.get.package', goGetPackage));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.playground', playgroundCommand));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.lint.package', lintCode));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.lint.workspace', () => lintCode(true)));

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
	return disposeTelemetryReporter();
}

function runBuilds(document: vscode.TextDocument, goConfig: vscode.WorkspaceConfiguration) {
	if (document.languageId !== 'go') {
		return;
	}

	errorDiagnosticCollection.clear();
	warningDiagnosticCollection.clear();
	check(document.uri, goConfig)
		.then((errors) => {
			handleDiagnosticErrors(document, errors);
		})
		.catch(err => {
			vscode.window.showInformationMessage('Error: ' + err);
		});
}

function startBuildOnSaveWatcher(subscriptions: vscode.Disposable[]) {
	vscode.workspace.onDidSaveTextDocument(document => {
		if (document.languageId !== 'go') {
			return;
		}
		runBuilds(document, vscode.workspace.getConfiguration('go', document.uri));
	}, null, subscriptions);
}

function sendTelemetryEventForConfig(goConfig: vscode.WorkspaceConfiguration) {
	/* __GDPR__
	   "goConfig" : {
		  "buildOnSave" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "buildFlags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "buildTags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "formatTool": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "formatFlags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
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
		  "codeLens": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
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
		includeImports: goConfig['gotoSymbol'] && goConfig['gotoSymbol']['includeImports'] + '',
		addTags: JSON.stringify(goConfig['addTags']),
		removeTags: JSON.stringify(goConfig['removeTags']),
		editorContextMenuCommands: JSON.stringify(goConfig['editorContextMenuCommands']),
		liveErrors: JSON.stringify(goConfig['liveErrors']),
		codeLens: JSON.stringify(goConfig['enableCodeLens'])
	});
}

function didLangServerConfigChange(useLangServer: boolean, langServerFlags: string[], newconfig: vscode.WorkspaceConfiguration) {
	let newLangServerFlags = newconfig['languageServerFlags'] || [];
	if (useLangServer !== newconfig['useLanguageServer'] || langServerFlags.length !== newLangServerFlags.length) {
		return true;
	}

	for (let i = 0; i < langServerFlags.length; i++) {
		if (newLangServerFlags[i] !== langServerFlags[i]) {
			return true;
		}
	}
	return false;
}

function loadPackages() {
	getAllPackages();
}
