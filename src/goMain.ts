/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { browsePackages } from './goBrowsePackage';
import { buildCode } from './goBuild';
import { check, notifyIfGeneratedFile, removeTestStatus } from './goCheck';
import { GoCodeActionProvider } from './goCodeAction';
import { applyCodeCoverage, initCoverageDecorators, removeCodeCoverageOnFileChange, toggleCoverageCurrentPackage, updateCodeCoverageDecorators } from './goCover';
import { GoDebugConfigurationProvider } from './goDebugConfiguration';
import { extractFunction, extractVariable } from './goDoctor';
import { runFillStruct } from './goFillStruct';
import * as goGenerateTests from './goGenerateTests';
import { goGetPackage } from './goGetPackage';
import { implCursor } from './goImpl';
import { addImport, addImportToWorkspace } from './goImport';
import { installCurrentPackage } from './goInstall';
import { installAllTools, installTools, offerToInstallTools, promptForMissingTool, updateGoPathGoRootFromConfig } from './goInstallTools';
import { registerLanguageFeatures } from './goLanguageServer';
import { lintCode } from './goLint';
import { GO_MODE } from './goMode';
import { addTags, removeTags } from './goModifytags';
import { GO111MODULE, isModSupported } from './goModules';
import { clearCacheForTools } from './goPath';
import { playgroundCommand } from './goPlayground';
import { GoReferencesCodeLensProvider } from './goReferencesCodelens';
import { GoRunTestCodeLensProvider } from './goRunTestCodelens';
import { showHideStatus } from './goStatus';
import { testAtCursor, testCurrentFile, testCurrentPackage, testPrevious, testWorkspace } from './goTest';
import { vetCode } from './goVet';
import { setGlobalState } from './stateUtils';
import { cancelRunningTests, showTestOutput } from './testUtils';
import { cleanupTempDir, disposeTelemetryReporter, getBinPath, getGoConfig, getCurrentGoPath, getExtensionCommands, getGoVersion, getToolsEnvVars, getToolsGopath, getWorkspaceFolderPath, handleDiagnosticErrors, isGoPathSet, sendTelemetryEvent } from './util';

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
				const currVersionString = currentVersion.format();

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

		// This handles all of the configurations and registrations for the language server.
		// It also registers the necessary language feature providers that the language server may not support.
		await registerLanguageFeatures(ctx);

		if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'go' && isGoPathSet()) {
			// Check mod status so that cache is updated and then run build/lint/vet
			isModSupported(vscode.window.activeTextEditor.document.uri).then(() => {
				runBuilds(vscode.window.activeTextEditor.document, getGoConfig());
			});
		}

	});

	initCoverageDecorators(ctx);

	ctx.subscriptions.push(vscode.commands.registerCommand('go.open.modulewiki', async () => {
		vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('https://github.com/microsoft/vscode-go/wiki/Go-modules-support-in-Visual-Studio-Code'));
	}));
	showHideStatus(vscode.window.activeTextEditor);

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
		const wasInfered = getGoConfig()['inferGopath'];
		const root = getWorkspaceFolderPath(vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);

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
		const goConfig = getGoConfig();
		testAtCursor(goConfig, 'test', args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.debug.cursor', (args) => {
		const goConfig = getGoConfig();
		testAtCursor(goConfig, 'debug', args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.benchmark.cursor', (args) => {
		const goConfig = getGoConfig();
		testAtCursor(goConfig, 'benchmark', args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.package', (args) => {
		const goConfig = getGoConfig();
		const isBenchmark = false;
		testCurrentPackage(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.benchmark.package', (args) => {
		const goConfig = getGoConfig();
		const isBenchmark = true;
		testCurrentPackage(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.file', (args) => {
		const goConfig = getGoConfig();
		const isBenchmark = false;
		testCurrentFile(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.benchmark.file', (args) => {
		const goConfig = getGoConfig();
		const isBenchmark = true;
		testCurrentFile(goConfig, isBenchmark, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.workspace', (args) => {
		const goConfig = getGoConfig();
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

	ctx.subscriptions.push(vscode.commands.registerCommand('go.tools.install', async (args) => {
		if (Array.isArray(args) && args.length) {
			const goVersion = await getGoVersion();
			installTools(args, goVersion);
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
		const updatedGoConfig = getGoConfig();
		sendTelemetryEventForConfig(updatedGoConfig);
		updateGoPathGoRootFromConfig();

		// If there was a change in "toolsGopath" setting, then clear cache for go tools
		if (getToolsGopath() !== getToolsGopath(false)) {
			clearCacheForTools();
		}

		if (updatedGoConfig['enableCodeLens']) {
			testCodeLensProvider.setEnabled(updatedGoConfig['enableCodeLens']['runtest']);
			referencesCodeLensProvider.setEnabled(updatedGoConfig['enableCodeLens']['references']);
		}

		if (e.affectsConfiguration('go.formatTool')) {
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
		if (e.affectsConfiguration('go.toolsEnvVars')) {
			const env = getToolsEnvVars();
			if (GO111MODULE !==  env['GO111MODULE']) {
				const reloadMsg = 'Reload VS Code window so that the Go tools can respect the change to GO111MODULE';
				vscode.window.showInformationMessage(reloadMsg, 'Reload').then((selected) => {
					if (selected === 'Reload') {
						vscode.commands.executeCommand('workbench.action.reloadWindow');
					}
				});
			}
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

	sendTelemetryEventForConfig(getGoConfig());
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
		if (vscode.debug.activeDebugSession) {
			vscode.window.showWarningMessage('A debug session is currently active. Changes to your Go files may result in unexpected behaviour.');
		}
		if (vscode.window.visibleTextEditors.some(e => e.document.fileName === document.fileName)) {
			runBuilds(document, getGoConfig(document.uri));
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
		  "languageServerExperimentalFeatures": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "includeImports": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "addTags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "removeTags": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "editorContextMenuCommands": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "liveErrors": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "codeLens": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		  "alternateTools": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		  "useGoProxyToCheckForToolUpdates": { "classification": "CustomerContent", "purpose": "FeatureInsight" }
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
		alternateTools: JSON.stringify(goConfig['alternateTools']),
		useGoProxyToCheckForToolUpdates: goConfig['useGoProxyToCheckForToolUpdates'] + '',
	});
}

function checkToolExists(tool: string) {
	if (tool === getBinPath(tool)) {
		promptForMissingTool(tool);
	}
}
