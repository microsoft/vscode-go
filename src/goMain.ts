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
import OutlineSupport = require('./goOutline');
import {check, ICheckResult} from './goCheck';
import {setupGoPathAndOfferToInstallTools} from './goPath'
import vscode = require('vscode');

export function activate(subscriptions: vscode.Disposable[]) {
	subscriptions.push(vscode.Modes.SuggestSupport.register('go', new SuggestSupport()));
	subscriptions.push(vscode.Modes.ExtraInfoSupport.register('go', new ExtraInfoSupport()));
	subscriptions.push(vscode.Modes.DeclarationSupport.register('go', new DeclarationSupport()));
	subscriptions.push(vscode.Modes.ReferenceSupport.register('go', new ReferencesSupport()));
	subscriptions.push(vscode.Modes.FormattingSupport.register('go', new FormattingSupport()));
	subscriptions.push(vscode.Modes.RenameSupport.register('go', new RenameSupport()));
	subscriptions.push(vscode.Modes.OutlineSupport.register('go', new OutlineSupport()));

	setupGoPathAndOfferToInstallTools();
	startBuildOnSaveWatcher();
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

	vscode.extensions.getConfigurationMemento('go').getValues().then((config = {}) => {
		vscode.workspace.onDidSaveTextDocument(document => {
			var uri = document.getUri();
			check(uri.fsPath, config['buildOnSave'], config['lintOnSave'], config['vetOnSave']).then(errors => {
				if (_diagnostics) {
					_diagnostics.dispose();
				}
				var diagnostics = errors.map(error => {
					let targetResource = vscode.Uri.file(error.file);
					let document = vscode.workspace.getTextDocument(targetResource);
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
					let location = new vscode.Location(uri, range);
					return new vscode.Diagnostic(mapSeverityToVSCodeSeverity(error.severity), location, error.msg);
				});
				_diagnostics = vscode.languages.addDiagnostics(diagnostics);
			}).catch(err => {
				vscode.window.showInformationMessage("Error: " + err);
			});
		});
	});
}
