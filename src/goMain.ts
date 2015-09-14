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
import monaco = require('monaco');

monaco.Modes.registerMonarchDefinition('go', languageDef);
monaco.Modes.SuggestSupport.register('go', new SuggestSupport(monaco.Services.ModelService));
monaco.Modes.ExtraInfoSupport.register('go', new ExtraInfoSupport(monaco.Services.ModelService));
monaco.Modes.DeclarationSupport.register('go', new DeclarationSupport(monaco.Services.ModelService));
monaco.Modes.FormattingSupport.register('go', new FormattingSupport(monaco.Services.ModelService));
monaco.Modes.RenameSupport.register('go', new RenameSupport(monaco.Services.ModelService));

function mapSeverityToMonacoSeverity(sev: string) {
	switch(sev) {
		case "error": return monaco.Services.Severity.Error;
		case "warning": return monaco.Services.Severity.Warning;
		default: return monaco.Services.Severity.Error;
	}
}

var watcher = monaco.Services.FileSystemEventService.createWatcher();
watcher.onFileChange(fileSystemEvent => {
	if(fileSystemEvent.resource.fsPath.indexOf('.go') !== -1) {
		check(fileSystemEvent.resource.fsPath).then(errors => {
			monaco.Services.MarkerService.changeAll('go', errors.map(error => {
				var targetResource = monaco.URI.file(error.file);
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
			monaco.showMessage(monaco.MessageSeverity.Information, "Error: " + err);
		});
	}
});
