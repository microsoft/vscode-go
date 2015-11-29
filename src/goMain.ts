/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
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
import { check, ICheckResult } from './goCheck';
import { setupGoPathAndOfferToInstallTools } from './goInstallTools'
import { GO_MODE } from './goMode'
import { showHideStatus } from './goStatus'
import { testAtCursor, testCurrentPackage, testCurrentFile } from './goTest'

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext): void {

	ctx.subscriptions.push(vscode.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
	ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider(GO_MODE, new GoCompletionItemProvider(), '.'));
	ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
	ctx.subscriptions.push(vscode.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
	ctx.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider()));
	ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSymbolProvider()));
	ctx.subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));

	diagnosticCollection = vscode.languages.createDiagnosticCollection('go');
	ctx.subscriptions.push(diagnosticCollection);
	
	vscode.window.onDidChangeActiveTextEditor(showHideStatus, null, ctx.subscriptions);
	setupGoPathAndOfferToInstallTools();
	startBuildOnSaveWatcher(ctx.subscriptions);

	ctx.subscriptions.push(vscode.commands.registerCommand("go.gopath", () => {
		var gopath = process.env["GOPATH"];
		vscode.window.showInformationMessage("Current GOPATH:" + gopath);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand("go.test.cursor", () => {
		let goConfig = vscode.workspace.getConfiguration('go');
		testAtCursor(goConfig['testTimeout']);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand("go.test.package", () => {
		let goConfig = vscode.workspace.getConfiguration('go');
		testCurrentPackage(goConfig['testTimeout']);
	}));

	ctx.subscriptions.push(vscode.commands.registerCommand("go.test.file", () => {
		let goConfig = vscode.workspace.getConfiguration('go');
		testCurrentFile(goConfig['testTimeout']);
	}));

	vscode.languages.setLanguageConfiguration(GO_MODE.language, {
		indentationRules: {
			// ^(.*\*/)?\s*\}.*$
			decreaseIndentPattern: /^(.*\*\/)?\s*\}.*$/,
			// ^.*\{[^}"']*$
			increaseIndentPattern: /^.*\{[^}"']*$/
		},
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
		comments: {
			lineComment: '//',
			blockComment: ['/*', '*/']
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')'],
		],

		__electricCharacterSupport: {
			brackets: [
				{ tokenType: 'delimiter.curly.ts', open: '{', close: '}', isElectric: true },
				{ tokenType: 'delimiter.square.ts', open: '[', close: ']', isElectric: true },
				{ tokenType: 'delimiter.paren.ts', open: '(', close: ')', isElectric: true }
			]
		},

		__characterPairSupport: {
			autoClosingPairs: [
				{ open: '{', close: '}' },
				{ open: '[', close: ']' },
				{ open: '(', close: ')' },
				{ open: '"', close: '"', notIn: ['string'] },
				{ open: '\'', close: '\'', notIn: ['string', 'comment'] }
			]
		}
	});

	if(vscode.window.activeTextEditor) {
		let goConfig = vscode.workspace.getConfiguration('go');
		runBuilds(vscode.window.activeTextEditor.document, goConfig);
	}
}

function deactivate() {
}

function runBuilds(document: vscode.TextDocument, goConfig: vscode.WorkspaceConfiguration) {
	
	function mapSeverityToVSCodeSeverity(sev: string) {
		switch (sev) {
			case "error": return vscode.DiagnosticSeverity.Error;
			case "warning": return vscode.DiagnosticSeverity.Warning;
			default: return vscode.DiagnosticSeverity.Error;
		}
	}
	
	if (document.languageId != "go") {
		return;
	}
	
	var uri = document.uri;
	check(uri.fsPath, goConfig['buildOnSave'], goConfig['lintOnSave'], goConfig['vetOnSave']).then(errors => {
		diagnosticCollection.clear();

		let diagnosticMap: Map<vscode.Uri, vscode.Diagnostic[]> = new Map();;

		errors.forEach(error => {
			let targetUri = vscode.Uri.file(error.file);
			let startColumn = 0;
			let endColumn = 1;
			if (document && document.uri.toString() == targetUri.toString()) {
				let range = new vscode.Range(error.line - 1, 0, error.line - 1, document.lineAt(error.line - 1).range.end.character + 1)
				let text = document.getText(range);
				let [_, leading, trailing] = /^(\s*).*(\s*)$/.exec(text);
				startColumn = leading.length;
				endColumn = text.length - trailing.length;
			}
			let range = new vscode.Range(error.line - 1, startColumn, error.line - 1, endColumn);
			let diagnostic = new vscode.Diagnostic(range, error.msg, mapSeverityToVSCodeSeverity(error.severity));
			let diagnostics = diagnosticMap.get(targetUri);
			if (!diagnostics) {
				diagnostics = [];
			}
			diagnostics.push(diagnostic);
			diagnosticMap.set(targetUri, diagnostics);
		});
		let entries: [vscode.Uri, vscode.Diagnostic[]][] = [];
		diagnosticMap.forEach((diags, uri) => {
			entries.push([uri, diags]);
		});
		diagnosticCollection.set(entries);
	}).catch(err => {
		vscode.window.showInformationMessage("Error: " + err);
	});
}

function startBuildOnSaveWatcher(subscriptions: vscode.Disposable[]) {
	
	// TODO: This is really ugly.  I'm not sure we can do better until
	// Code supports a pre-save event where we can do the formatting before
	// the file is written to disk.	
	let alreadyAppliedFormatting = new WeakSet<vscode.TextDocument>();
	
	vscode.workspace.onDidSaveTextDocument(document => {
		if (document.languageId != "go") {
			return;
		}
		let goConfig = vscode.workspace.getConfiguration('go');
		var textEditor = vscode.window.activeTextEditor
		if (goConfig["formatOnSave"] && textEditor.document == document && !alreadyAppliedFormatting.has(document)) {
			var formatter = new Formatter();
			formatter.formatDocument(document).then(edits => {
				return textEditor.edit(editBuilder => {
					edits.forEach(edit => editBuilder.replace(edit.range, edit.newText));
				});
			}).then(applied => {
				alreadyAppliedFormatting.add(document);
				// This will cause the onDidSaveTextDocument handler to be re-entered 
				// and will go into the error-checking phase of the save operation.
				return document.save();
			});
		} else {
			alreadyAppliedFormatting.delete(document);
			runBuilds(document, goConfig);
		}
	}, null, subscriptions);

}
