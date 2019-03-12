'use strict';

import vscode = require('vscode');
import path = require('path');
import { getCurrentGoPath, getToolsEnvVars, sendTelemetryEvent, getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';

export class GoDebugConfigurationProvider implements vscode.DebugConfigurationProvider {

	public provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.DebugConfiguration[] {
		return [
			{
				'name': 'Launch',
				'type': 'go',
				'request': 'launch',
				'mode': 'auto',
				'program': '${fileDirname}',
				'env': {},
				'args': []
			}
		];
	}

	public resolveDebugConfiguration?(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.DebugConfiguration {
		if (debugConfiguration) {
			/* __GDPR__
				"debugConfiguration" : {
					"request" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"mode" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"useApiV<NUMBER>": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"stopOnEntry": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			sendTelemetryEvent('debugConfiguration', {
				request: debugConfiguration.request,
				mode: debugConfiguration.mode,
				useApiV1: debugConfiguration.useApiV1,
				stopOnEntry: debugConfiguration.stopOnEntry
			});
		}

		const activeEditor = vscode.window.activeTextEditor;
		if (!debugConfiguration || !debugConfiguration.request) { // if 'request' is missing interpret this as a missing launch.json
			if (!activeEditor || activeEditor.document.languageId !== 'go') {
				return;
			}

			debugConfiguration = {
				'name': 'Launch',
				'type': 'go',
				'request': 'launch',
				'mode': 'auto',
				'program': activeEditor.document.fileName
			};
		}

		const gopath = getCurrentGoPath(folder ? folder.uri : null);
		if (!debugConfiguration['env']) {
			debugConfiguration['env'] = { 'GOPATH': gopath };
		} else if (!debugConfiguration['env']['GOPATH']) {
			debugConfiguration['env']['GOPATH'] = gopath;
		}

		const goConfig = vscode.workspace.getConfiguration('go', folder ? folder.uri : null);
		const goToolsEnvVars = getToolsEnvVars();
		Object.keys(goToolsEnvVars).forEach(key => {
			if (!debugConfiguration['env'].hasOwnProperty(key)) {
				debugConfiguration['env'][key] = goToolsEnvVars[key];
			}
		});

		const dlvConfig: { [key: string]: any } = goConfig.get('delveConfig');
		if (!debugConfiguration.hasOwnProperty('useApiV1') && dlvConfig.hasOwnProperty('useApiV1')) {
			debugConfiguration['useApiV1'] = dlvConfig['useApiV1'];
		}
		if (!debugConfiguration.hasOwnProperty('apiVersion') && dlvConfig.hasOwnProperty('apiVersion')) {
			debugConfiguration['apiVersion'] = dlvConfig['apiVersion'];
		}
		if (!debugConfiguration.hasOwnProperty('dlvLoadConfig') && dlvConfig.hasOwnProperty('dlvLoadConfig')) {
			debugConfiguration['dlvLoadConfig'] = dlvConfig['dlvLoadConfig'];
		}
		if (!debugConfiguration.hasOwnProperty('showGlobalVariables') && dlvConfig.hasOwnProperty('showGlobalVariables')) {
			debugConfiguration['showGlobalVariables'] = dlvConfig['showGlobalVariables'];
		}

		debugConfiguration['dlvToolPath'] = getBinPath('dlv');
		if (!path.isAbsolute(debugConfiguration['dlvToolPath'])) {
			promptForMissingTool('dlv');
			return;
		}

		if (debugConfiguration['mode'] === 'auto') {
			debugConfiguration['mode'] = (activeEditor && activeEditor.document.fileName.endsWith('_test.go')) ? 'test' : 'debug';
		}
		debugConfiguration['currentFile'] = activeEditor && activeEditor.document.languageId === 'go' && activeEditor.document.fileName;

		return debugConfiguration;
	}

}
