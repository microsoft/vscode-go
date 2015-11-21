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
import { GoDocumentFormattingEditProvider } from './goFormat';
import { GoRenameProvider } from './goRename';
import { GoDocumentSybmolProvider } from './goOutline';
import { check, ICheckResult } from './goCheck';
import { setupGoPathAndOfferToInstallTools } from './goPath'
import { GO_MODE } from './goMode'
import { showHideStatus } from './goStatus'

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext): void {

	ctx.subscriptions.push(vscode.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
	ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider(GO_MODE, new GoCompletionItemProvider(), '.'));
	ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
	ctx.subscriptions.push(vscode.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
	ctx.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider()));
	ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSybmolProvider()));
	ctx.subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));

	diagnosticCollection = vscode.languages.createDiagnosticCollection('go');
	ctx.subscriptions.push(diagnosticCollection);
	ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(showHideStatus));
	setupGoPathAndOfferToInstallTools();
	ctx.subscriptions.push(startBuildOnSaveWatcher());
	
	ctx.subscriptions.push(vscode.commands.registerCommand("go.gopath", () => {
		var gopath = process.env["GOPATH"];
		vscode.window.showInformationMessage("Current GOPATH:" + gopath);
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
				{ tokenType:'delimiter.curly.ts', open: '{', close: '}', isElectric: true },
				{ tokenType:'delimiter.square.ts', open: '[', close: ']', isElectric: true },
				{ tokenType:'delimiter.paren.ts', open: '(', close: ')', isElectric: true }
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

}

function deactivate() {
}

function startBuildOnSaveWatcher() {

	function mapSeverityToVSCodeSeverity(sev: string) {
		switch (sev) {
			case "error": return vscode.DiagnosticSeverity.Error;
			case "warning": return vscode.DiagnosticSeverity.Warning;
			default: return vscode.DiagnosticSeverity.Error;
		}
	}

	let goConfig = vscode.workspace.getConfiguration('go');

	return vscode.workspace.onDidSaveTextDocument(document => {
		if(document.languageId != "go") {
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
				if(!diagnostics) {
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
	});

}
