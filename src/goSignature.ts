/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath'
import { languages, window, commands, SignatureHelpProvider, SignatureHelp, SignatureInformation, ParameterInformation, TextDocument, Position, CancellationToken } from 'vscode';
import { definitionLocation } from "./goDeclaration"

export class GoSignatureHelpProvider implements SignatureHelpProvider {
	public provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): Promise<SignatureHelp> {			let parenthesesPosition = this.lastParentheses(document, position);
		if(parenthesesPosition == null) {
			return null;
		}

		let callerPos = this.previousTokenPosition(document, parenthesesPosition);				

		return definitionLocation(document, callerPos).then(res => {
			var result = new SignatureHelp();
			let signatureBegin = res.lines[1].indexOf("(") // func Printf(a ...interface{}) => (a ...interface{})
			var si = new SignatureInformation(res.lines[1].substring(signatureBegin), "");
			
			result.signatures = [si];
			result.activeSignature = 0;
			result.activeParameter = 0;
			return result;
		}).catch(err => {
			console.log(err);
		});
	}
	
	public previousTokenPosition(document: TextDocument, position: Position): Position {
		while(position.character > 0) {
			var word = document.getWordRangeAtPosition(position)
			if (word) {
				return word.start;
			}
			position = position.translate(0, -1);
		}
		return null;
	}

	public lastParentheses(document: TextDocument, position: Position): Position {
		// TODO: handle double '(('
		var currentLine = document.lineAt(position.line).text.substring(0,position.character);
		var lastIndex = currentLine.lastIndexOf("(");
		
		if(lastIndex < 0)
			return null;
		
		return new Position(position.line, lastIndex);
	}

}
