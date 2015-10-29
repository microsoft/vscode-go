/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

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
import {check, ICheckResult} from './goCheck';
import vscode = require('vscode');

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(subscriptions: vscode.Disposable[]): void {
	var GO_MODE = 'go';

	subscriptions.push(vscode.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
	subscriptions.push(vscode.languages.registerCompletionItemProvider(GO_MODE, new GoCompletionItemProvider()));
	subscriptions.push(vscode.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
	subscriptions.push(vscode.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
	subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider()));
	subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSybmolProvider()));
	subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));

	setupGoPathAndOfferToInstallTools();
	startBuildOnSaveWatcher();

	diagnosticCollection = vscode.languages.createDiagnosticCollection('go');
	subscriptions.push(diagnosticCollection);
}

function setupGoPathAndOfferToInstallTools() {
	// TODO: There should be a better way to do this?
	var gopath = vscode.workspace.getConfiguration('go')['gopath'];

	// Make sure GOPATH is set
	if (!process.env["GOPATH"] && gopath) {
		process.env["GOPATH"] = gopath;
	}

	if (!process.env["GOPATH"]) {
		vscode.languages.addWarningLanguageStatus("go", "GOPATH not set", () => {
			vscode.window.showInformationMessage("GOPATH is not set as an environment variable or via `go.gopath` setting in Code");
		});
		return;
	}

	// Offer to install any missing tools
	var tools = {
		gorename: "golang.org/x/tools/cmd/gorename",
		gocode: "github.com/nsf/gocode",
		goreturns: "sourcegraph.com/sqs/goreturns",
		godef: "github.com/rogpeppe/godef",
		golint: "github.com/golang/lint/golint",
		"go-find-references": "github.com/lukehoban/go-find-references",
		"go-outline": "github.com/lukehoban/go-outline"
	}
	var keys = Object.keys(tools)
	Promise.all(keys.map(tool => new Promise<string>((resolve, reject) => {
		let toolPath = path.join(process.env["GOPATH"], 'bin', tool);
		if (process.platform === 'win32')
			toolPath = toolPath + ".exe";
		fs.exists(toolPath, exists => {
			resolve(exists ? null : tools[tool])
		});
	}))).then(res => {
		var missing = res.filter(x => x != null);
		if (missing.length > 0) {
			let status = vscode.languages.addWarningLanguageStatus("go", "Analysis Tools Missing", () => {
				promptForInstall(missing, status);
			});
		}
	});

	function promptForInstall(missing: string[], status: vscode.Disposable) {

		var channel = vscode.window.createOutputChannel('Go');
		channel.reveal();

		// TODO@EG wait for new API which doesn
		// vscode.window.showInformationMessage("Some Go analysis tools are missing from your GOPATH.  Would you like to install them?", {
		// 	title: "Install",
		// 	command: () => {
		// 		missing.forEach(tool => {
		// 			var p = cp.exec("go get -u -v " + tool, { cwd: process.env['GOPATH'], env: process.env });
		// 			p.stderr.on('data', (data: string) => {
		// 				channel.append(data);
		// 			});
		// 		});
		// 	}
		// });
		status.dispose();
	}
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

	vscode.workspace.onDidSaveTextDocument(document => {
		var uri = document.uri;
		check(uri.fsPath, goConfig['buildOnSave'], goConfig['lintOnSave'], goConfig['vetOnSave']).then(errors => {
			diagnosticCollection.clear();

			var diagnostics = errors.map(error => {
				let targetResource = vscode.Uri.file(error.file);
				let document = vscode.workspace.getTextDocument(targetResource);
				let startColumn = 0;
				let endColumn = 1;
				if (document) {
					let range = new vscode.Range(error.line - 1, 0, error.line - 1, document.lineAt(error.line - 1).range.end.character + 1)
					let text = document.getText(range);
					let [_, leading, trailing] = /^(\s*).*(\s*)$/.exec(text);
					startColumn = leading.length;
					endColumn = text.length - trailing.length;
				}
				let range = new vscode.Range(error.line - 1, startColumn, error.line - 1, endColumn);
				let location = new vscode.Location(uri, range);
				return new vscode.Diagnostic(range, error.msg, mapSeverityToVSCodeSeverity(error.severity));
			});
			diagnosticCollection.set(uri, diagnostics);
		}).catch(err => {
			vscode.window.showInformationMessage("Error: " + err);
		});
	});

}
