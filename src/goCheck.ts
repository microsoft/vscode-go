/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import path = require('path');
import { applyCodeCoverageToAllEditors } from './goCover';
import { outputChannel, diagnosticsStatusBarItem } from './goStatus';
import { goTest, TestConfig, getTestFlags } from './testUtils';
import { ICheckResult, getTempFilePath } from './util';
import { goLint } from './goLint';
import { goVet } from './goVet';
import { goBuild } from './goBuild';
import { isModSupported } from './goModules';
import { buildDiagnosticCollection, lintDiagnosticCollection, vetDiagnosticCollection } from './goMain';
import { getToolFromToolPath } from './goPath';
import { parseLanguageServerConfig } from './goLanguageServer';

const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
statusBarItem.command = 'go.test.showOutput';
const neverAgain = { title: 'Don\'t Show Again' };

export function removeTestStatus(e: vscode.TextDocumentChangeEvent) {
	if (e.document.isUntitled) {
		return;
	}
	statusBarItem.hide();
	statusBarItem.text = '';
}

export function notifyIfGeneratedFile(this: void, e: vscode.TextDocumentChangeEvent) {
	const ctx: any = this;
	if (e.document.isUntitled || e.document.languageId !== 'go') {
		return;
	}

	const documentUri = e ? e.document.uri : null;
	const goConfig = vscode.workspace.getConfiguration('go', documentUri);

	if ((ctx.globalState.get('ignoreGeneratedCodeWarning') !== true) && e.document.lineAt(0).text.match(/^\/\/ Code generated .* DO NOT EDIT\.$/)) {
		vscode.window.showWarningMessage('This file seems to be generated. DO NOT EDIT.', neverAgain).then(result => {
			if (result === neverAgain) {
				ctx.globalState.update('ignoreGeneratedCodeWarning', true);
			}
		});
	}
}

interface IToolCheckResults {
	diagnosticCollection: vscode.DiagnosticCollection;
	errors: ICheckResult[];
}

export function check(fileUri: vscode.Uri, goConfig: vscode.WorkspaceConfiguration): Promise<IToolCheckResults[]> {
	diagnosticsStatusBarItem.hide();
	outputChannel.clear();
	const runningToolsPromises = [];
	const cwd = path.dirname(fileUri.fsPath);

	// If a user has enabled diagnostics via a language server, 
	// then we disable running build or vet to avoid duplicate errors and warnings.
	let lspConfig = parseLanguageServerConfig();
	let disableBuildAndVet = lspConfig.features.diagnostics;

	let testPromise: Thenable<boolean>;
	let tmpCoverPath: string;
	const testConfig: TestConfig = {
		goConfig: goConfig,
		dir: cwd,
		flags: getTestFlags(goConfig),
		background: true
	};

	const runTest = () => {
		if (testPromise) {
			return testPromise;
		}

		if (goConfig['coverOnSave']) {
			tmpCoverPath = getTempFilePath('go-code-cover');
			testConfig.flags.push('-coverprofile=' + tmpCoverPath);
		}

		testPromise = isModSupported(fileUri).then(isMod => {
			testConfig.isMod = isMod;
			return goTest(testConfig);
		});
		return testPromise;
	};

	if (!disableBuildAndVet && !!goConfig['buildOnSave'] && goConfig['buildOnSave'] !== 'off') {
		runningToolsPromises.push(isModSupported(fileUri)
			.then(isMod => goBuild(fileUri, isMod, goConfig, goConfig['buildOnSave'] === 'workspace'))
			.then(errors => ({ diagnosticCollection: buildDiagnosticCollection, errors })));
	}

	if (!!goConfig['testOnSave']) {
		statusBarItem.show();
		statusBarItem.text = 'Tests Running';
		runTest().then(success => {
			if (statusBarItem.text === '') {
				return;
			}
			if (success) {
				statusBarItem.text = 'Tests Passed';
			} else {
				statusBarItem.text = 'Tests Failed';
			}
		});
	}

	if (!!goConfig['lintOnSave'] && goConfig['lintOnSave'] !== 'off') {
		runningToolsPromises.push(goLint(fileUri, goConfig, goConfig['lintOnSave'])
			.then(errors => ({ diagnosticCollection: lintDiagnosticCollection, errors: errors })));
	}

	if (!disableBuildAndVet && !!goConfig['vetOnSave'] && goConfig['vetOnSave'] !== 'off') {
		runningToolsPromises.push(goVet(fileUri, goConfig, goConfig['vetOnSave'] === 'workspace')
			.then(errors => ({ diagnosticCollection: vetDiagnosticCollection, errors: errors })));
	}

	if (!!goConfig['coverOnSave']) {
		runTest().then(success => {
			if (!success) {
				return [];
			}
			// FIXME: it's not obvious that tmpCoverPath comes from runTest()
			return applyCodeCoverageToAllEditors(tmpCoverPath, testConfig.dir);
		});
	}

	return Promise.all(runningToolsPromises);
}
