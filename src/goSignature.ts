/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { SignatureHelpProvider, SignatureHelp, SignatureInformation, ParameterInformation, TextDocument, Position, CancellationToken, WorkspaceConfiguration } from 'vscode';
import { definitionLocation } from './goDeclaration';
import { getParametersAndReturnType, isPositionInString } from './util';

export class GoSignatureHelpProvider implements SignatureHelpProvider {

	constructor(private goConfig?: WorkspaceConfiguration) {
	}

	public async provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): Promise<SignatureHelp> {
		let goConfig = this.goConfig || vscode.workspace.getConfiguration('go', document.uri);

		const theCall = this.walkBackwardsToBeginningOfCall(document, position);
		if (theCall == null) {
			return Promise.resolve(null);
		}
		const callerPos = this.previousTokenPosition(document, theCall.openParen);
		// Temporary fix to fall back to godoc if guru is the set docsTool
		if (goConfig['docsTool'] === 'guru') {
			goConfig = Object.assign({}, goConfig, { 'docsTool': 'godoc' });
		}
		try {
			const res = await definitionLocation(document, callerPos, goConfig, true, token);
			if (!res) {
				// The definition was not found
				return null;
			}
			if (res.line === callerPos.line) {
				// This must be a function definition
				return null;
			}
			let declarationText: string = (res.declarationlines || []).join(' ').trim();
			if (!declarationText) {
				return null;
			}
			const result = new SignatureHelp();
			let sig: string;
			let si: SignatureInformation;
			if (res.toolUsed === 'godef') {
				// declaration is of the form "Add func(a int, b int) int"
				const nameEnd = declarationText.indexOf(' ');
				const sigStart = nameEnd + 5; // ' func'
				const funcName = declarationText.substring(0, nameEnd);
				sig = declarationText.substring(sigStart);
				si = new SignatureInformation(funcName + sig, res.doc);
			}
			else if (res.toolUsed === 'gogetdoc') {
				// declaration is of the form "func Add(a int, b int) int"
				declarationText = declarationText.substring(5);
				const funcNameStart = declarationText.indexOf(res.name + '('); // Find 'functionname(' to remove anything before it
				if (funcNameStart > 0) {
					declarationText = declarationText.substring(funcNameStart);
				}
				si = new SignatureInformation(declarationText, res.doc);
				sig = declarationText.substring(res.name.length);
			}
			si.parameters = getParametersAndReturnType(sig).params.map(paramText => new ParameterInformation(paramText));
			result.signatures = [si];
			result.activeSignature = 0;
			result.activeParameter = Math.min(theCall.commas.length, si.parameters.length - 1);
			return result;
		} catch (e) {
			return null;
		}
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

	/**
	 * Goes through the function params' lines and gets the number of commas and the start position of the call.
	 */
	private walkBackwardsToBeginningOfCall(document: TextDocument, position: Position): { openParen: Position, commas: Position[] } | null {
		let parenBalance = 0;
		let maxLookupLines = 30;
		const commas = [];

		for (let lineNr = position.line; lineNr >= 0 && maxLookupLines >= 0; lineNr-- , maxLookupLines--) {

			const line = document.lineAt(lineNr);
			// if its current line, get the text until the position given, otherwise get the full line.
			const [currentLine, characterPosition] = lineNr === position.line
				? [line.text.substring(0, position.character), position.character]
				: [line.text, line.text.length - 1];

			for (let char = characterPosition - 1; char >= 0; char--) {
				switch (currentLine[char]) {
					case '(':
						parenBalance--;
						if (parenBalance < 0) {
							return {
								openParen: new Position(lineNr, char),
								commas
							};
						}
						break;
					case ')':
						parenBalance++;
						break;
					case ',':
						const commaPos = new Position(lineNr, char);
						if ((parenBalance === 0) && !isPositionInString(document, commaPos)) {
							commas.push(commaPos);
						}
						break;
				}
			}
		}
		return null;
	}
}
