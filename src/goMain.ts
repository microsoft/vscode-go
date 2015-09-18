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
	vscode.Modes.SuggestSupport.register('go', new SuggestSupport(vscode.Services.ModelService));
	vscode.Modes.ExtraInfoSupport.register('go', new ExtraInfoSupport(vscode.Services.ModelService));
	vscode.Modes.DeclarationSupport.register('go', new DeclarationSupport(vscode.Services.ModelService));
	vscode.Modes.ReferenceSupport.register('go', new ReferencesSupport(vscode.Services.ModelService));
	vscode.Modes.FormattingSupport.register('go', new FormattingSupport(vscode.Services.ModelService, vscode.Services.ConfigurationService));
	vscode.Modes.RenameSupport.register('go', new RenameSupport(vscode.Services.ModelService));

	// TODO: There should be a better way to do this?
	vscode.Services.ConfigurationService.loadConfiguration('go').then(config => {

		// Make sure GOPATH is set
		if(!process.env["GOPATH"] && config.gopath) {
			process.env["GOPATH"] = config.gopath;
		}

		// Offer to install any missing tools
		var tools = {
			gorenameX: "golang.org/x/tools/cmd/gorename",
			gocode: "github.com/nsf/gocode",
			goreturns: "sourcegraph.com/sqs/goreturns",
			godef: "github.com/rogpeppe/godef",
			golint: "github.com/golang/lint/golint",
			"go-find-references": "github.com/redefiance/go-find-references"
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
					promptForInstall(missing, tools, status);
				});
			}
		});
	});

	function promptForInstall(missing: string[], tools, status: vscode.Disposable) {
		vscode.shell.showInformationMessage("Some Go analysis tools are missing from your GOPATH.  Would you like to install them?", {
			title: "Install",
			command: () => {
				missing.forEach(tool  => {
					cp.execSync("go get -u -v " + tools[tool]);
				});
			}
		});
		status.dispose();
	}

	function mapSeverityToMonacoSeverity(sev: string) {
		switch(sev) {
			case "error": return vscode.Services.Severity.Error;
			case "warning": return vscode.Services.Severity.Warning;
			default: return vscode.Services.Severity.Error;
		}
	}

	vscode.Services.ConfigurationService.loadConfiguration('go').then((config = {}) => {
		var watcher = vscode.Services.FileSystemEventService.createWatcher();
		watcher.onFileChange(fileSystemEvent => {
			if(fileSystemEvent.resource.fsPath.indexOf('.go') !== -1) {
				check(fileSystemEvent.resource.fsPath, config['buildOnSave'], config['lintOnSave'], config['vetOnSave']).then(errors => {
					vscode.Services.MarkerService.changeAll('go', errors.map(error => {
						var targetResource = vscode.Uri.file(error.file);
						var model = vscode.Services.ModelService.getModel(targetResource);
						var startColumn = 0;
						var endColumn = 1;
						if(model) {
							var text = model.getValueInRange({
								startLineNumber: error.line,
								endLineNumber: error.line,
								startColumn: 0,
								endColumn: model.getLineMaxColumn(error.line)
							});
							var [_, leading, trailing] = /^(\s*).*(\s*)$/.exec(text);
							startColumn = leading.length + 1;
							endColumn = text.length - trailing.length + 1;
						}
						return {
							resource: targetResource,
							marker: {
								severity: mapSeverityToMonacoSeverity(error.severity),
								message: error.msg,
								startLineNumber: error.line,
								endLineNumber: error.line,
								startColumn,
								endColumn
							}
						};
					}));
				}).catch(err => {
					vscode.shell.showInformationMessage("Error: " + err);
				});
			}
		});
	});
}
