/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import * as goGenerateTests from './goGenerateTests';
import { setGlobalState } from './stateUtils';
import { updateGoPathGoRootFromConfig, installAllTools, offerToInstallTools, installTools, promptForMissingTool } from './goInstallTools';
import { getToolsGopath, getCurrentGoPath, getGoVersion, isGoPathSet, getExtensionCommands, disposeTelemetryReporter, cleanupTempDir, handleDiagnosticErrors, sendTelemetryEvent, getBinPath, getWorkspaceFolderPath, getToolsEnvVars } from './util';
import { registerLanguageFeatures } from './goLanguageServer';
import { initCoverageDecorators, toggleCoverageCurrentPackage, updateCodeCoverageDecorators, removeCodeCoverageOnFileChange, applyCodeCoverage } from './goCover';
import { showHideStatus } from './goStatus';
import { GoRunTestCodeLensProvider } from './goRunTestCodelens';
import { GoReferencesCodeLensProvider } from './goReferencesCodelens';
import { GO_MODE } from './goMode';
import { GoCodeActionProvider } from './goCodeAction';
import { GoDebugConfigurationProvider } from './goDebugConfiguration';
import { fixDriveCasingInWindows, clearCacheForTools } from './goPath';
import { addTags, removeTags } from './goModifytags';
import { runFillStruct } from './goFillStruct';
import { implCursor } from './goImpl';
import { extractFunction, extractVariable } from './goDoctor';
import { testAtCursor, testCurrentPackage, testCurrentFile, testWorkspace, testPrevious } from './goTest';
import { showTestOutput, cancelRunningTests } from './testUtils';
import { addImport, addImportToWorkspace } from './goImport';
import { browsePackages } from './goBrowsePackage';
import { goGetPackage } from './goGetPackage';
import { playgroundCommand } from './goPlayground';
import { lintCode } from './goLint';
import { vetCode } from './goVet';
import { buildCode } from './goBuild';
import { installCurrentPackage } from './goInstall';
import { check, removeTestStatus, notifyIfGeneratedFile } from './goCheck';
import { GO111MODULE } from './goModules';
import { activate as activateTreeSitter } from 'vscode-tree-sitter';
import { color } from './treeSitter';
import * as path from 'path';

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
			runBuilds(vscode.window.activeTextEditor.document, vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor.document.uri));
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
		const wasInfered = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null)['inferGopath'];
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
		const updatedGoConfig = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
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

	sendTelemetryEventForConfig(vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null));
	// Parse .go files incrementally using tree-sitter
	const parserPath = path.join(ctx.extensionPath, 'parsers', 'tree-sitter-go.wasm');
	activateTreeSitter(ctx, {'go': {wasm: parserPath}}).then(colorAll);
	function colorAll() {
		for (const editor of vscode.window.visibleTextEditors) {
			color(editor);
		}
	}
	function colorEdited(evt: vscode.TextDocumentChangeEvent) {
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() === evt.document.uri.toString()) {
				color(editor);
			}
		}
	}
	function onChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
		const colorizationNeedsReload: boolean = event.affectsConfiguration('workbench.colorTheme')
			|| event.affectsConfiguration('editor.tokenColorCustomizations');
		if (colorizationNeedsReload) {
			colorAll();
		}
	}
	ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onChangeConfiguration));
	ctx.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(colorAll));
	ctx.subscriptions.push(vscode.window.onDidChangeTextEditorVisibleRanges(change => color(change.textEditor)));
	ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(colorEdited));
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
