/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');

export class GoRefactorProvider implements vscode.CodeActionProvider {
	public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeAction[]> {
		const extractFunction = new vscode.CodeAction(
			'Extract Function',
			vscode.CodeActionKind.RefactorExtract
		);
		extractFunction.command = {
			title: 'Extract Function',
			command: 'go.godoctor.extract',
			arguments: [
				document,
				range,
			],
		};

		return [extractFunction];
	}
}