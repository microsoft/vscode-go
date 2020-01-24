/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import path = require('path');
import vscode = require('vscode');
import { goBuild } from './goBuild';
import { parseLanguageServerConfig } from './goLanguageServer';
import { goLint } from './goLint';
import { buildDiagnosticCollection, lintDiagnosticCollection, vetDiagnosticCollection } from './goMain';
import { isModSupported } from './goModules';
import { diagnosticsStatusBarItem, outputChannel } from './goStatus';
import { goVet } from './goVet';
import { getTestFlags, goTest, TestConfig } from './testUtils';
import { ICheckResult } from './util';

const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
statusBarItem.command = 'go.test.showOutput';
const neverAgain = { title: `Don't Show Again` };

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
	if (
		ctx.globalState.get('ignoreGeneratedCodeWarning') !== true &&
		e.document.lineAt(0).text.match(/^\/\/ Code generated .* DO NOT EDIT\.$/)
	) {
		vscode.window.showWarningMessage('This file seems to be generated. DO NOT EDIT.', neverAgain).then((result) => {
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
	const lspConfig = parseLanguageServerConfig();
	const disableBuildAndVet = lspConfig.enabled && lspConfig.features.diagnostics;

	let testPromise: Thenable<boolean>;
	const testConfig: TestConfig = {
		goConfig,
		dir: cwd,
		flags: getTestFlags(goConfig),
		background: true,
		applyCodeCoverage: !!goConfig['coverOnSave']
	};

	const runTest = () => {
		if (testPromise) {
			return testPromise;
		}

		testPromise = isModSupported(fileUri).then((isMod) => {
			testConfig.isMod = isMod;
			return goTest(testConfig);
		});
		return testPromise;
	};

	if (!disableBuildAndVet && !!goConfig['buildOnSave'] && goConfig['buildOnSave'] !== 'off') {
		runningToolsPromises.push(
			isModSupported(fileUri)
				.then((isMod) => goBuild(fileUri, isMod, goConfig, goConfig['buildOnSave'] === 'workspace'))
				.then((errors) => ({ diagnosticCollection: buildDiagnosticCollection, errors }))
		);
	}

	if (!!goConfig['testOnSave']) {
		statusBarItem.show();
		statusBarItem.text = 'Tests Running';
		runTest().then((success) => {
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
		runningToolsPromises.push(
			goLint(fileUri, goConfig, goConfig['lintOnSave']).then((errors) => ({
				diagnosticCollection: lintDiagnosticCollection,
				errors
			}))
		);
	}

	if (!disableBuildAndVet && !!goConfig['vetOnSave'] && goConfig['vetOnSave'] !== 'off') {
		runningToolsPromises.push(
			goVet(fileUri, goConfig, goConfig['vetOnSave'] === 'workspace').then((errors) => ({
				diagnosticCollection: vetDiagnosticCollection,
				errors
			}))
		);
	}

	if (!!goConfig['coverOnSave']) {
		runTest().then((success) => {
			if (!success) {
				return [];
			}
		});
	}

	return Promise.all(runningToolsPromises);
}
