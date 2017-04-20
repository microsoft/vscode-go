/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict'

import vscode = require('vscode');
import { CodeLensProvider, TextDocument, CancellationToken, CodeLens, Command } from 'vscode';
import { getTestFunctions } from './goTest';

export class GoRunTestCodeLensProvider implements CodeLensProvider {
	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
		return getTestFunctions(document).then(testFunctions => {
			return testFunctions.map(func => {
				let showReferences: Command = {
					title: 'run test',
					command: 'go.test.function',
					arguments: [ func.name ]
				};
				return new CodeLens(func.location.range, showReferences);
			});
		});
	}
}