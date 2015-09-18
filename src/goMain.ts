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
import monaco = require('vscode');

monaco.Modes.SuggestSupport.register('go', new SuggestSupport(monaco.Services.ModelService));
monaco.Modes.ExtraInfoSupport.register('go', new ExtraInfoSupport(monaco.Services.ModelService));
monaco.Modes.DeclarationSupport.register('go', new DeclarationSupport(monaco.Services.ModelService));
monaco.Modes.ReferenceSupport.register('go', new ReferencesSupport(monaco.Services.ModelService));
monaco.Modes.FormattingSupport.register('go', new FormattingSupport(monaco.Services.ModelService, monaco.Services.ConfigurationService));
monaco.Modes.RenameSupport.register('go', new RenameSupport(monaco.Services.ModelService));

// TODO: There should be a better way to do this?
monaco.Services.ConfigurationService.loadConfiguration('go').then(config => {

	// Make sure GOPATH is set
	if(!process.env["GOPATH"] && config.gopath) {
		process.env["GOPATH"] = config.gopath;
	}

	// Offer to install any missing tools
	var tools = {
		gorename: "golang.org/x/tools/cmd/gorename",
		gocode: "github.com/nsf/gocode",
		goreturns: "sourcegraph.com/sqs/goreturns",
		godef: "github.com/rogpeppe/godef",
		golint: "github.com/golang/lint/golint",
		"go-find-references": "github.com/redefiance/go-find-references"
	}
	var keys = Object.keys(tools)
	Promise.all(keys.map(tool => new Promise<string>((resolve, reject) => {
		return fs.exists(path.join(process.env["GOPATH"], 'bin', tool), exists => exists ? null : tools[tool]);
	}))).then(res => {
		var missing = res.filter(x => x != null);
		if(missing.length > 0) {
			monaco.shell.showInformationMessage("Some Go analysis tools are missing from your GOPATH.  Would you like to install them?", {
				title: "Install",
				command: () => {
					missing.forEach(tool  => {
						console.log(tools[tool]);
						cp.execSync("go get -u -v " + tools[tool]);
					});
				}
			});
		}
	});
});

function mapSeverityToMonacoSeverity(sev: string) {
	switch(sev) {
		case "error": return monaco.Services.Severity.Error;
		case "warning": return monaco.Services.Severity.Warning;
		default: return monaco.Services.Severity.Error;
	}
}

monaco.Services.ConfigurationService.loadConfiguration('go').then((config = {}) => {
	var watcher = monaco.Services.FileSystemEventService.createWatcher();
	watcher.onFileChange(fileSystemEvent => {
		if(fileSystemEvent.resource.fsPath.indexOf('.go') !== -1) {
			check(fileSystemEvent.resource.fsPath, config['buildOnSave'], config['lintOnSave'], config['vetOnSave']).then(errors => {
				monaco.Services.MarkerService.changeAll('go', errors.map(error => {
					var targetResource = monaco.Uri.file(error.file);
					var model = monaco.Services.ModelService.getModel(targetResource);
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
				monaco.shell.showInformationMessage("Error: " + err);
			});
		}
	});
});
