/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import vscode = require('vscode');

export abstract class GoBaseCodeLensProvider implements vscode.CodeLensProvider {
	protected enabled: boolean = true;
	private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();

	public get onDidChangeCodeLenses(): vscode.Event<void> {
		return this.onDidChangeCodeLensesEmitter.event;
	}

	public setEnabled(enabled: false): void {
		if (this.enabled !== enabled) {
			this.enabled = enabled;
			this.onDidChangeCodeLensesEmitter.fire();
		}
	}

	public provideCodeLenses(
		document: vscode.TextDocument,
		token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.CodeLens[]> {
		return [];
	}
}
