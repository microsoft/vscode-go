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

		const gopath = getCurrentGoPath(folder ? folder.uri : null);

		if (!debugConfiguration || !debugConfiguration.request) { // if 'request' is missing interpret this as a missing launch.json
			let activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor || activeEditor.document.languageId !== 'go') {
				return;
			}

			return {
				'name': 'Launch',
				'type': 'go',
				'request': 'launch',
				'mode': 'debug',
				'program': activeEditor.document.fileName,
				'env': {
					'GOPATH': gopath
				}
			};
		}

		if (!debugConfiguration['env']) {
			debugConfiguration['env'] = { 'GOPATH': gopath };
		} else if (!debugConfiguration['env']['GOPATH']) {
			debugConfiguration['env']['GOPATH'] = gopath;
		}

		return debugConfiguration;
	}

}