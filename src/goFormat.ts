/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import {getBinPath} from './goPath'
import { GoFormatter } from './format';

export class GoDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {

	// Not used?
	public autoFormatTriggerCharacters: string[] = [';', '}', '\n'];

	public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
		return document.save().then(() => {
			return this.doFormatDocument(document, options, token);
		});
	}

	private doFormatDocument(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
		var formatter = new GoFormatter();
		return formatter.provideDocumentFormattingEdits(document);
	}

}
