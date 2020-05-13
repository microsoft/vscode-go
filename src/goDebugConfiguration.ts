/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import path = require('path');
import vscode = require('vscode');
import { promptForMissingTool } from './goInstallTools';
import { packagePathToGoModPathMap } from './goModules';
import { getFromGlobalState, updateGlobalState } from './stateUtils';
import { sendTelemetryEventForDebugConfiguration } from './telemetry';
import { getBinPath, getCurrentGoPath, getGoConfig, getToolsEnvVars } from './util';

export class GoDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	public provideDebugConfigurations(
		folder: vscode.WorkspaceFolder | undefined,
		token?: vscode.CancellationToken
	): vscode.DebugConfiguration[] {
		return [
			{
				name: 'Launch',
				type: 'go',
				request: 'launch',
				mode: 'auto',
				program: '${fileDirname}',
				env: {},
				args: []
			}
		];
	}

	public resolveDebugConfiguration?(
		folder: vscode.WorkspaceFolder | undefined,
		debugConfiguration: vscode.DebugConfiguration,
		token?: vscode.CancellationToken
	): vscode.DebugConfiguration {
		if (debugConfiguration) {
			sendTelemetryEventForDebugConfiguration(debugConfiguration);
		}

		const activeEditor = vscode.window.activeTextEditor;
		if (!debugConfiguration || !debugConfiguration.request) {
			// if 'request' is missing interpret this as a missing launch.json
			if (!activeEditor || activeEditor.document.languageId !== 'go') {
				return;
			}

			debugConfiguration = Object.assign(debugConfiguration || {}, {
				name: 'Launch',
				type: 'go',
				request: 'launch',
				mode: 'auto',
				program: path.dirname(activeEditor.document.fileName) // matches ${fileDirname}
			});
		}

		debugConfiguration['packagePathToGoModPathMap'] = packagePathToGoModPathMap;

		const gopath = getCurrentGoPath(folder ? folder.uri : undefined);
		if (!debugConfiguration['env']) {
			debugConfiguration['env'] = { GOPATH: gopath };
		} else if (!debugConfiguration['env']['GOPATH']) {
			debugConfiguration['env']['GOPATH'] = gopath;
		}

		const goConfig = getGoConfig(folder && folder.uri);
		const goToolsEnvVars = getToolsEnvVars();
		Object.keys(goToolsEnvVars).forEach((key) => {
			if (!debugConfiguration['env'].hasOwnProperty(key)) {
				debugConfiguration['env'][key] = goToolsEnvVars[key];
			}
		});

		const dlvConfig = goConfig.get<any>('delveConfig');
		let useApiV1 = false;
		if (debugConfiguration.hasOwnProperty('useApiV1')) {
			useApiV1 = debugConfiguration['useApiV1'] === true;
		} else if (dlvConfig.hasOwnProperty('useApiV1')) {
			useApiV1 = dlvConfig['useApiV1'] === true;
		}
		if (useApiV1) {
			debugConfiguration['apiVersion'] = 1;
		}
		if (!debugConfiguration.hasOwnProperty('apiVersion') && dlvConfig.hasOwnProperty('apiVersion')) {
			debugConfiguration['apiVersion'] = dlvConfig['apiVersion'];
		}
		if (!debugConfiguration.hasOwnProperty('dlvLoadConfig') && dlvConfig.hasOwnProperty('dlvLoadConfig')) {
			debugConfiguration['dlvLoadConfig'] = dlvConfig['dlvLoadConfig'];
		}
		if (
			!debugConfiguration.hasOwnProperty('showGlobalVariables') &&
			dlvConfig.hasOwnProperty('showGlobalVariables')
		) {
			debugConfiguration['showGlobalVariables'] = dlvConfig['showGlobalVariables'];
		}
		if (debugConfiguration.request === 'attach' && !debugConfiguration['cwd']) {
			debugConfiguration['cwd'] = '${workspaceFolder}';
		}

		debugConfiguration['dlvToolPath'] = getBinPath('dlv');
		if (!path.isAbsolute(debugConfiguration['dlvToolPath'])) {
			promptForMissingTool('dlv');
			return;
		}

		if (debugConfiguration['mode'] === 'auto') {
			debugConfiguration['mode'] =
				activeEditor && activeEditor.document.fileName.endsWith('_test.go') ? 'test' : 'debug';
		}

		if (debugConfiguration.request === 'launch' && debugConfiguration['mode'] === 'remote') {
			this.showWarning(
				'ignoreDebugLaunchRemoteWarning',
				`Request type of 'launch' with mode 'remote' is deprecated, please use request type 'attach' with mode 'remote' instead.`
			);
		}

		if (
			debugConfiguration.request === 'attach' &&
			debugConfiguration['mode'] === 'remote' &&
			debugConfiguration['program']
		) {
			this.showWarning(
				'ignoreUsingRemotePathAndProgramWarning',
				`Request type of 'attach' with mode 'remote' does not work with 'program' attribute, please use 'cwd' attribute instead.`
			);
		}
		return debugConfiguration;
	}

	private showWarning(ignoreWarningKey: string, warningMessage: string) {
		const ignoreWarning = getFromGlobalState(ignoreWarningKey);
		if (ignoreWarning) {
			return;
		}

		const neverAgain = { title: `Don't Show Again` };
		vscode.window.showWarningMessage(warningMessage, neverAgain).then((result) => {
			if (result === neverAgain) {
				updateGlobalState(ignoreWarningKey, true);
			}
		});
	}
}
