/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import fs = require('fs');
import path = require('path');
import cp = require('child_process');
import { GoCompletionItemProvider } from './goSuggest';
import { GoHoverProvider } from './goExtraInfo';
import { GoDefinitionProvider } from './goDeclaration';
import { GoReferenceProvider } from './goReferences';
import { GoDocumentFormattingEditProvider, Formatter } from './goFormat';
import { GoRenameProvider } from './goRename';
import { GoDocumentSymbolProvider } from './goOutline';
import { GoSignatureHelpProvider } from './goSignature';
import { GoWorkspaceSymbolProvider } from './goSymbol';
import { GoCodeActionProvider } from './goCodeAction';
import { check, ICheckResult } from './goCheck';
import { updateGoPathGoRootFromConfig, setupGoPathAndOfferToInstallTools } from './goInstallTools';
import { GO_MODE } from './goMode';
import { showHideStatus } from './goStatus';
import { coverageCurrentPackage, getCodeCoverage, removeCodeCoverage } from './goCover';
import { testAtCursor, testCurrentPackage, testCurrentFile, testPrevious } from './goTest';
import * as goGenerateTests from './goGenerateTests';
import { addImport } from './goImport';
import { installAllTools, checkLanguageServer } from './goInstallTools';
import { isGoPathSet, getBinPath } from './util';
import { LanguageClient } from 'vscode-languageclient';
import { clearCacheForTools } from './goPath';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext): void {
	let useLangServer = vscode.workspace.getConfiguration('go')['useLanguageServer'];
	let toolsGopath = vscode.workspace.getConfiguration('go')['toolsGopath'];
	if (checkLanguageServer()) {
		const c = new LanguageClient(
			'langserver-go',
			{
				command: getBinPath('langserver-go'),
				args: [
					'-mode=stdio'
				],
			},
			{
				documentSelector: ['go'],
				uriConverters: {
					// Apply file:/// scheme to all file paths.
					code2Protocol: (uri: vscode.Uri): string => (uri.scheme ? uri : uri.with({ scheme: 'file' })).toString(),
					protocol2Code: (uri: string) => vscode.Uri.parse(uri),
				},
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
	}

	ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider(GO_MODE, new GoCompletionItemProvider(), '.', '\"'));
	ctx.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider()));
	ctx.subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));
	ctx.subscriptions.push(vscode.languages.registerCodeActionsProvider(GO_MODE, new GoCodeActionProvider()));

	diagnosticCollection = vscode.languages.createDiagnosticCollection('go');
	ctx.subscriptions.push(diagnosticCollection);
	vscode.workspace.onDidChangeTextDocument(removeCodeCoverage, null, ctx.subscriptions);
	vscode.window.onDidChangeActiveTextEditor(showHideStatus, null, ctx.subscriptions);
	vscode.window.onDidChangeActiveTextEditor(getCodeCoverage, null, ctx.subscriptions);

	setupGoPathAndOfferToInstallTools();
	startBuildOnSaveWatcher(ctx.subscriptions);

	ctx.subscriptions.push(vscode.commands.registerCommand('go.gopath', () => {
		let gopath = process.env['GOPATH'];
		let wasInfered = vscode.workspace.getConfiguration('go')['inferGopath'];

		// not only if it was configured, but if it was successful.
		if (wasInfered && vscode.workspace.rootPath.indexOf(gopath) === 0) {
			vscode.window.showInformationMessage('Current GOPATH is inferred from workspace root: ' + gopath);
		} else {
			vscode.window.showInformationMessage('Current GOPATH: ' + gopath);
		}
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.cursor', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go');
		testAtCursor(goConfig, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.package', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go');
		testCurrentPackage(goConfig, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.file', (args) => {
		let goConfig = vscode.workspace.getConfiguration('go');
		testCurrentFile(goConfig, args);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.previous', () => {
		testPrevious();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.test.coverage', () => {
		coverageCurrentPackage();
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.import.add', (arg: string) => {
		return addImport(typeof arg === 'string' ? arg : null);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand('go.tools.install', () => {
		installAllTools();
	}));

	ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
		updateGoPathGoRootFromConfig();
		let updatedGoConfig = vscode.workspace.getConfiguration('go');

		// If there was a change in "useLanguageServer" setting, then ask the user to reload VS Code.
		if (process.platform !== 'win32'
			&& useLangServer !== updatedGoConfig['useLanguageServer']
			&& (!updatedGoConfig['useLanguageServer'] || checkLanguageServer())) {
			vscode.window.showInformationMessage('Reload VS Code window for the change in usage of language server to take effect', 'Reload').then(selected => {
				if (selected === 'Reload') {
					vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			});
		}
		useLangServer = updatedGoConfig['useLanguageServer'];

		// If there was a change in "toolsGopath" setting, then clear cache for go tools
		if (toolsGopath !== updatedGoConfig['toolsGopath']) {
			clearCacheForTools();
			toolsGopath = updatedGoConfig['toolsGopath'];
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
		if (!config.request) { // if 'request' is missing interpret this as a missing launch.json
			config = Object.assign(config, {
				'name': 'Launch',
				'type': 'go',
				'request': 'launch',
				'mode': 'debug',
				'program': '${workspaceRoot}'
			});
		}
		vscode.commands.executeCommand('vscode.startDebug', config);
	}));

	vscode.languages.setLanguageConfiguration(GO_MODE.language, {
		indentationRules: {
			// ^(.*\*/)?\s*\}.*$
			decreaseIndentPattern: /^(.*\*\/)?\s*\}.*$/,
			// ^.*\{[^}'']*$
			increaseIndentPattern: /^.*\{[^}'']*$/
		},
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
	});

	if (vscode.window.activeTextEditor && isGoPathSet()) {
		let goConfig = vscode.workspace.getConfiguration('go');
		runBuilds(vscode.window.activeTextEditor.document, goConfig);
	}
}

function deactivate() {
}

function runBuilds(document: vscode.TextDocument, goConfig: vscode.WorkspaceConfiguration) {

	function mapSeverityToVSCodeSeverity(sev: string) {
		switch (sev) {
			case 'error': return vscode.DiagnosticSeverity.Error;
			case 'warning': return vscode.DiagnosticSeverity.Warning;
			default: return vscode.DiagnosticSeverity.Error;
		}
	}

	if (document.languageId !== 'go') {
		return;
	}

	let uri = document.uri;
	check(uri.fsPath, goConfig).then(errors => {
		diagnosticCollection.clear();

		let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();

		errors.forEach(error => {
			let canonicalFile = vscode.Uri.file(error.file).toString();
			let startColumn = 0;
			let endColumn = 1;
			if (document && document.uri.toString() === canonicalFile) {
				let range = new vscode.Range(error.line - 1, 0, error.line - 1, document.lineAt(error.line - 1).range.end.character + 1);
				let text = document.getText(range);
				let [_, leading, trailing] = /^(\s*).*(\s*)$/.exec(text);
				startColumn = leading.length;
				endColumn = text.length - trailing.length;
			}
			let range = new vscode.Range(error.line - 1, startColumn, error.line - 1, endColumn);
			let diagnostic = new vscode.Diagnostic(range, error.msg, mapSeverityToVSCodeSeverity(error.severity));
			let diagnostics = diagnosticMap.get(canonicalFile);
			if (!diagnostics) {
				diagnostics = [];
			}
			diagnostics.push(diagnostic);
			diagnosticMap.set(canonicalFile, diagnostics);
		});
		diagnosticMap.forEach((diags, file) => {
			diagnosticCollection.set(vscode.Uri.parse(file), diags);
		});
	}).catch(err => {
		vscode.window.showInformationMessage('Error: ' + err);
	});
}

function startBuildOnSaveWatcher(subscriptions: vscode.Disposable[]) {

	// TODO: This is really ugly.  I'm not sure we can do better until
	// Code supports a pre-save event where we can do the formatting before
	// the file is written to disk.
	let ignoreNextSave = new WeakSet<vscode.TextDocument>();

	vscode.workspace.onDidSaveTextDocument(document => {
		if (document.languageId !== 'go' || ignoreNextSave.has(document)) {
			return;
		}
		let goConfig = vscode.workspace.getConfiguration('go');
		let textEditor = vscode.window.activeTextEditor;
		let formatPromise: PromiseLike<void> = Promise.resolve();
		if (goConfig['formatOnSave'] && textEditor.document === document) {
			let formatter = new Formatter();
			formatPromise = formatter.formatDocument(document).then(edits => {
				return textEditor.edit(editBuilder => {
					edits.forEach(edit => editBuilder.replace(edit.range, edit.newText));
				});
			}).then(applied => {
				ignoreNextSave.add(document);
				return document.save();
			}).then(() => {
				ignoreNextSave.delete(document);
			}, () => {
				// Catch any errors and ignore so that we still trigger
				// the file save.
			});
		}
		formatPromise.then(() => {
			runBuilds(document, goConfig);
		});
	}, null, subscriptions);

}

