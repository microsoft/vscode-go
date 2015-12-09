/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath'
import { languages, window, commands, SignatureHelpProvider, SignatureHelp, SignatureInformation, ParameterInformation, TextDocument, Position, Range, CancellationToken } from 'vscode';
import { definitionLocation } from "./goDeclaration"

export class GoSignatureHelpProvider implements SignatureHelpProvider {

	public provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): Promise<SignatureHelp> {
		let parenthesesPosition = this.lastParentheses(document, position);
		if (parenthesesPosition == null) {
			return null;
		}
		let callerPos = this.previousTokenPosition(document, parenthesesPosition);
		return definitionLocation(document, callerPos).then(res => {
			let result = new SignatureHelp();
			let text = res.lines[1];
			let nameEnd = text.indexOf(" ");
			let sigStart = nameEnd + 5;
			let si = new SignatureInformation(text.substring(0, nameEnd) + text.substring(sigStart),"");
			result.signatures = [si];
			result.activeSignature = 0;
			result.activeParameter = 0;
			return result;
		});
	}

	private previousTokenPosition(document: TextDocument, position: Position): Position {
		while (position.character > 0) {
			var word = document.getWordRangeAtPosition(position)
			if (word) {
				return word.start;
			}
			position = position.translate(0, -1);
		}
		return null;
	}

	private lastParentheses(document: TextDocument, position: Position): Position {
		// TODO: handle double '(('
		var currentLine = document.lineAt(position.line).text.substring(0, position.character);
		var lastIndex = currentLine.lastIndexOf("(");

		if (lastIndex < 0)
			return null;

		return new Position(position.line, lastIndex);
	}

}
