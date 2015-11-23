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
import { GoDocumentSymbolProvider } from './goOutline';
import { check, ICheckResult } from './goCheck';
import { setupGoPathAndOfferToInstallTools } from './goInstallTools'
import { GO_MODE } from './goMode'
import { showHideStatus } from './goStatus'

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
	ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(showHideStatus));
	setupGoPathAndOfferToInstallTools();
	ctx.subscriptions.push(startBuildOnSaveWatcher());
	ctx.subscriptions.push(flymakeWatcher());
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

}

function deactivate() {
}

var autobuildErrors = []
var flymakeErrors = []
class Flymake {
	private t : NodeJS.Timer

	constructor() {
	}
		
	compile(document : vscode.TextDocument) {
		var dirname = path.dirname(document.fileName)
		var flymakePrefix = "flymake_"

		var docs = vscode.workspace.textDocuments
		var dirty = new Set<vscode.TextDocument>()
		docs.forEach(function(d) {
			if(d.isDirty && (path.dirname(d.fileName) == dirname)) {
				dirty.add(d)
			}
		})
		
		var gobuild = new Promise((resolve, reject) => {
			var files = []
			
			try {
				dirty.forEach(function (d) {
					var flyname = flymakePrefix + path.basename(d.fileName)
					var targetname = path.join(dirname, flyname)
					var text = d.getText()
					files.push(targetname)
					fs.writeFileSync(targetname, text)
				})		
			} catch(e) {
				reject(e);
				return
			}
	
			cp.execFile("/Users/matthew/go/bin/goflymake", files, {cwd: dirname}, (err, stdout, stderr) => {
				try {
					files.forEach(function (f) {
						fs.unlinkSync(f)
					})
				} catch(e) {
					// Ignore
				}

				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'go' compiler is not available.  Install Go from http://golang.org/dl/.");
						return resolve([]);
					}
					var lines = stdout.toString().split('\n');
					console.log(lines)
					var ret: ICheckResult[] = [];
					for(var i = 1; i < lines.length; i++) {
						// Building tests with flymake results in file:line:col:error
						// Building a regular file with flymake results in file:line:error
						var match = /^([^:]+):(\d+):(?:\d+:){0,1} (.*)/.exec(lines[i])
						if(!match) continue
						var [_, file, lineStr, msg] = match;
						var line = +lineStr;
						var base = path.basename(file)
						if(base.startsWith(flymakePrefix)) {
							base = base.substr(flymakePrefix.length)
						}

						ret.push({ file: path.resolve(dirname, base), line, msg, severity: "error" });
					}
					resolve(ret);
				} catch(e) {
					reject(e);
				}
			})
		})
		
		Promise.all([gobuild]).then(errors => {
			flymakeErrors = errors
			showErrors()
		}).catch(err => {
			vscode.window.showInformationMessage("Error: " + err);
		})
	}

	add(document : vscode.TextDocument) {
		if(this.t != null) {
			clearTimeout(this.t)				
		}

		var that = this
		this.t = setTimeout(function() { 
			that.t = null
			that.compile(document)
		}, 1000)
	}	
}

function flymakeWatcher() {
	var flymake = new Flymake()
	return vscode.workspace.onDidChangeTextDocument(change => {
		if(change.document.languageId != "go") {
			return
		}		
		flymake.add(change.document)
	})
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
		if (document.languageId != "go") {
			return;
		}
		var uri = document.uri;
		check(uri.fsPath, goConfig['buildOnSave'], goConfig['lintOnSave'], goConfig['vetOnSave']).then(errors => {
			autobuildErrors = errors
			showErrors()
		}).catch(err => {
			vscode.window.showInformationMessage("Error: " + err);
		});
	});
}

function showErrors() {
	function mapSeverityToVSCodeSeverity(sev: string) {
		switch (sev) {
			case "error": return vscode.DiagnosticSeverity.Error;
			case "warning": return vscode.DiagnosticSeverity.Warning;
			default: return vscode.DiagnosticSeverity.Error;
		}
	}

	diagnosticCollection.clear();

	let diagnosticMap: Map<vscode.Uri, vscode.Diagnostic[]> = new Map();

	var docs = vscode.workspace.textDocuments
	var errors = [].concat.apply(autobuildErrors, flymakeErrors) 
	errors.forEach(error => {
		let targetUri = vscode.Uri.file(error.file);
		let startColumn = 0;
		let endColumn = 1;

		for(var i = 0; i < docs.length; i++) {
			var document = docs[i]
			console.log(document.uri.toString())
			if (document.uri.toString() == targetUri.toString()) {
				let range = new vscode.Range(error.line - 1, 0, error.line - 1, document.lineAt(error.line - 1).range.end.character + 1)
				let text = document.getText(range);
				let [_, leading, trailing] = /^(\s*).*(\s*)$/.exec(text);
				startColumn = leading.length;
				endColumn = text.length - trailing.length;
				break
			}
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
}