'use strict';

import vscode = require('vscode');
import { getCurrentGoPath, getToolsEnvVars } from './util';

export class GoDebugConfigurationProvider implements vscode.DebugConfigurationProvider {

	public provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.DebugConfiguration[] {
		return [
			{
				'name': 'Launch',
				'type': 'go',
				'request': 'launch',
				'mode': 'auto',
				'remotePath': '',
				'port': 2345,
				'host': '127.0.0.1',
				'program': '${fileDirname}',
				'env': {},
				'args': [],
				'showLog': false
			}
		];
	}

	public resolveDebugConfiguration?(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.DebugConfiguration {
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

		const dlvConfig = goConfig.get('delveConfig');
		if (!debugConfiguration.hasOwnProperty('useApiV1') && dlvConfig.hasOwnProperty('useApiV1')) {
			debugConfiguration['useApiV1'] = dlvConfig['useApiV1'];
		}
		if (!debugConfiguration.hasOwnProperty('dlvLoadConfig') && dlvConfig.hasOwnProperty('dlvLoadConfig')) {
			debugConfiguration['dlvLoadConfig'] = dlvConfig['dlvLoadConfig'];
		}

		if (debugConfiguration['mode'] === 'auto') {
			debugConfiguration['mode'] = (activeEditor && activeEditor.document.fileName.endsWith('_test.go')) ? 'test' : 'debug';
		}

		return debugConfiguration;
	}

}