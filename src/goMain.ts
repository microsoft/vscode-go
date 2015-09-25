/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import fs = require('fs');
import path = require('path');
import cp = require('child_process');

import SuggestSupport = require('./goSuggest');
import ExtraInfoSupport = require('./goExtraInfo');
import DeclarationSupport = require('./goDeclaration');
import ReferencesSupport = require('./goReferences');
import FormattingSupport = require('./goFormat');
import RenameSupport = require('./goRename');
import {check, ICheckResult} from './goCheck';
import vscode = require('vscode');

export function activate() {
	vscode.Modes.SuggestSupport.register('go', new SuggestSupport());
	vscode.Modes.ExtraInfoSupport.register('go', new ExtraInfoSupport());
	vscode.Modes.DeclarationSupport.register('go', new DeclarationSupport());
	vscode.Modes.ReferenceSupport.register('go', new ReferencesSupport());
	vscode.Modes.FormattingSupport.register('go', new FormattingSupport());
	vscode.Modes.RenameSupport.register('go', new RenameSupport());

	setupGoPathAndOfferToInstallTools();
	startBuildOnSaveWatcher();
}

function setupGoPathAndOfferToInstallTools() {
	// TODO: There should be a better way to do this?
	vscode.plugins.getConfigurationObject('go').getValue<string>('gopath').then(gopath => {

		// Make sure GOPATH is set
		if(!process.env["GOPATH"] && gopath) {
			process.env["GOPATH"] = gopath;
		}

		// Offer to install any missing tools
		var tools = {
			gorename: "golang.org/x/tools/cmd/gorename",
			gocode: "github.com/nsf/gocode",
			goreturns: "sourcegraph.com/sqs/goreturns",
			godef: "github.com/rogpeppe/godef",
			golint: "github.com/golang/lint/golint",
			"go-find-references": "github.com/lukehoban/go-find-references"
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
			if(missing.length > 0) {
				let status = vscode.languages.addWarningLanguageStatus("go", "Analysis Tools Missing", () => {
					promptForInstall(missing, status);
				});
			}
		});

		function promptForInstall(missing: string[], status: vscode.Disposable) {
			vscode.window.showInformationMessage("Some Go analysis tools are missing from your GOPATH.  Would you like to install them?", {
				title: "Install",
				command: () => {
					missing.forEach(tool  => {
						vscode.window.runInTerminal("go", ["get", "-u", "-v", tool], { cwd: process.env['GOPATH'] });
					});
				}
			});
			status.dispose();
		}
	});
}

let _diagnostics:vscode.Disposable = null;

function deactivate() {
	if (_diagnostics) {
		_diagnostics.dispose();
	}
}

function startBuildOnSaveWatcher() {

	function mapSeverityToVSCodeSeverity(sev: string) {
		switch(sev) {
			case "error": return vscode.DiagnosticSeverity.Error;
			case "warning": return vscode.DiagnosticSeverity.Warning;
			default: return vscode.DiagnosticSeverity.Error;
		}
	}

	vscode.plugins.getConfigurationObject('go').getValues().then((config = {}) => {
		vscode.workspace.onDidSaveDocument(document => {
			check(document.getUri().fsPath, config['buildOnSave'], config['lintOnSave'], config['vetOnSave']).then(errors => {
				if (_diagnostics) {
					_diagnostics.dispose();
				}
				var diagnostics = errors.map(error => {
					let targetResource = vscode.Uri.file(error.file);
					let document = vscode.workspace.getDocument(targetResource);
					let startColumn = 0;
					let endColumn = 1;
					if (document) {
						let range = new vscode.Range(error.line, 0, error.line, document.getLineMaxColumn(error.line));
						let text = document.getTextInRange(range);
						let [_, leading, trailing] = /^(\s*).*(\s*)$/.exec(text);
						startColumn = leading.length + 1;
						endColumn = text.length - trailing.length + 1;
					}
					let range = new vscode.Range(error.line, startColumn, error.line, endColumn);
					let location = new vscode.Location(document.getUri(), range);
					return new vscode.Diagnostic(mapSeverityToVSCodeSeverity(error.severity), location, error.msg);
				});
				_diagnostics = vscode.languages.addDiagnostics(diagnostics);
			}).catch(err => {
				vscode.window.showInformationMessage("Error: " + err);
			});
		});
	});
}
