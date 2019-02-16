/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');

export class GoRefactorProvider implements vscode.CodeActionProvider {
	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.CodeAction[]> {
		const extractFunction = new vscode.CodeAction(
			'Extract to function in package scope',
			vscode.CodeActionKind.RefactorExtract
		);
		const extractVar = new vscode.CodeAction(
			'Extract to variable in local scope',
			vscode.CodeActionKind.RefactorExtract
		);
		extractFunction.command = {
			title: 'Extract to function in package scope',
			command: 'go.godoctor.extract'
		};
		extractVar.command = {
			title: 'Extract to variable in local scope',
			command: 'go.godoctor.var'
		};

		return [extractFunction, extractVar];
	}
}
