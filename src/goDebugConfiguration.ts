'use strict';

import vscode = require('vscode');
import { getCurrentGoPath } from './util';

export class GoDebugConfigurationProvider implements vscode.DebugConfigurationProvider {

	public provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.DebugConfiguration[] {
		return [
			{
				'name': 'Launch',
				'type': 'go',
				'request': 'launch',
				'mode': 'debug',
				'remotePath': '',
				'port': 2345,
				'host': '127.0.0.1',
				'program': '${fileDirname}',
				'env': {},
				'args': [],
				'showLog': true
			}
		];
	}

	public resolveDebugConfiguration?(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.DebugConfiguration {
		if (!debugConfiguration || !debugConfiguration.request) { // if 'request' is missing interpret this as a missing launch.json
			let activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor || activeEditor.document.languageId !== 'go') {
				return;
			}
			let debugMode;
			let testFileRegExp = RegExp('.*_test\.go$', 'g');
			if (testFileRegExp.test(activeEditor.document.fileName) === true) {
				debugMode = 'test';
			} else {
				debugMode = 'debug';
			}

			debugConfiguration = {
				'name': 'Launch',
				'type': 'go',
				'request': 'launch',
				'mode': debugMode,
				'program': activeEditor.document.fileName
			};
		}
		const gopath = getCurrentGoPath(folder ? folder.uri : null);
		if (!debugConfiguration['env']) {
			debugConfiguration['env'] = { 'GOPATH': gopath };
		} else if (!debugConfiguration['env']['GOPATH']) {
			debugConfiguration['env']['GOPATH'] = gopath;
		}

		const dlvConfig = vscode.workspace.getConfiguration('go', folder ? folder.uri : null).get('delveConfig');
		if (!debugConfiguration.hasOwnProperty('useApiV1') && dlvConfig.hasOwnProperty('useApiV1')) {
			debugConfiguration['useApiV1'] = dlvConfig['useApiV1'];
		}
		if (!debugConfiguration.hasOwnProperty('dlvLoadConfig') && dlvConfig.hasOwnProperty('dlvLoadConfig')) {
			debugConfiguration['dlvLoadConfig'] = dlvConfig['dlvLoadConfig'];
		}

		return debugConfiguration;
	}

}