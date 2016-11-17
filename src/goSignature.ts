/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import { languages, window, commands, SignatureHelpProvider, SignatureHelp, SignatureInformation, ParameterInformation, TextDocument, Position, Range, CancellationToken } from 'vscode';
import { definitionLocation } from './goDeclaration';
import { parameters } from './util';

export class GoSignatureHelpProvider implements SignatureHelpProvider {

	public provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): Promise<SignatureHelp> {
		let theCall = this.walkBackwardsToBeginningOfCall(document, position);
		if (theCall == null) {
			return Promise.resolve(null);
		}
		let callerPos = this.previousTokenPosition(document, theCall.openParen);
		return definitionLocation(document, callerPos).then(res => {
			if (!res) {
				// The definition was not found
				return null;
			}
			if (res.line === callerPos.line) {
				// This must be a function definition
				return null;
			}
			let result = new SignatureHelp();
			let text, sig: string;
			let si: SignatureInformation;
			if (res.toolUsed === 'godef') {
				// declaration is of the form "Add func(a int, b int) int"
				text = res.declarationlines[0];
				let nameEnd = text.indexOf(' ');
				let sigStart = nameEnd + 5; // ' func'
				let funcName = text.substring(0, nameEnd);
				sig = text.substring(sigStart);
				si = new SignatureInformation(funcName + sig, res.doc);
			} else {
				// declaration is of the form "func Add(a int, b int) int"
				text = res.declarationlines[0].substring(5);
				si = new SignatureInformation(text, res.doc);
				let braceStart = text.indexOf('(');
				sig = text.substring(braceStart);
			}

			si.parameters = parameters(sig).map(paramText =>
				new ParameterInformation(paramText)
			);
			result.signatures = [si];
			result.activeSignature = 0;
			result.activeParameter = Math.min(theCall.commas.length, si.parameters.length - 1);
			return result;
		});
	}

	private previousTokenPosition(document: TextDocument, position: Position): Position {
		while (position.character > 0) {
			let word = document.getWordRangeAtPosition(position);
			if (word) {
				return word.start;
			}
			position = position.translate(0, -1);
		}
		return null;
	}

	private walkBackwardsToBeginningOfCall(document: TextDocument, position: Position): { openParen: Position, commas: Position[] } {
		let currentLine = document.lineAt(position.line).text.substring(0, position.character);
		let parenBalance = 0;
		let commas = [];
		for (let char = position.character; char >= 0; char--) {
			switch (currentLine[char]) {
				case '(':
					parenBalance--;
					if (parenBalance < 0) {
						return {
							openParen: new Position(position.line, char),
							commas: commas
						};
					}
					break;
				case ')':
					parenBalance++;
					break;
				case ',':
					if (parenBalance === 0) {
						commas.push(new Position(position.line, char));
					}
			}
		}
		return null;
	}

}
