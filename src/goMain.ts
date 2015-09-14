/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import languageDef = require('./goDef');
import SuggestSupport = require('./goSuggest');
import ExtraInfoSupport = require('./goExtraInfo');
import DeclarationSupport = require('./goDeclaration');
import FormattingSupport = require('./goFormat');
import RenameSupport = require('./goRename');
import {check, ICheckResult} from './goCheck';
import vscode = require('vscode');

vscode.Modes.registerMonarchDefinition('go', languageDef);
vscode.Modes.SuggestSupport.register('go', new SuggestSupport(vscode.Services.ModelService));
vscode.Modes.ExtraInfoSupport.register('go', new ExtraInfoSupport(vscode.Services.ModelService));
vscode.Modes.DeclarationSupport.register('go', new DeclarationSupport(vscode.Services.ModelService));
vscode.Modes.FormattingSupport.register('go', new FormattingSupport(vscode.Services.ModelService));
vscode.Modes.RenameSupport.register('go', new RenameSupport(vscode.Services.ModelService));

function mapSeverityToMonacoSeverity(sev: string) {
	switch(sev) {
		case "error": return vscode.Services.Severity.Error;
		case "warning": return vscode.Services.Severity.Warning;
		default: return vscode.Services.Severity.Error;
	}
}

var watcher = vscode.Services.FileSystemEventService.createWatcher();
watcher.onFileChange(fileSystemEvent => {
	if(fileSystemEvent.resource.fsPath.indexOf('.go') !== -1) {
		check(fileSystemEvent.resource.fsPath).then(errors => {
			vscode.Services.MarkerService.changeAll('go', errors.map(error => {
				var targetResource = vscode.URI.file(error.file);
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
			vscode.shell.showErrorMessage("Error: " + err);
		});
	}
});
