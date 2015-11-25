/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath'
import { languages, window, SignatureHelpProvider, SignatureHelp, SignatureInformation, ParameterInformation, TextDocument, Position, CancellationToken } from 'vscode';

export class GoSignatureHelpProvider implements SignatureHelpProvider {
	public provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): Promise<SignatureHelp> {
		return new Promise((resolve, reject) => {
			// Experimental support, works only on standard library for now
			
			// TODO: Handle Depth at the | mark =>  fmt.Printf("%s", myMessage(|))
			let bracketPosition = this.lastParentheses(document, position);
			let tokens = this.previousTokens(document, bracketPosition);
			let funcName = tokens.pop()
			let pkgName = tokens.pop()
			
			// TODO: handle instance methods => myInstance.DoSomething()
			let fullName = pkgName + "." + funcName;
			
			let go = getBinPath("go");
			// Spawn `go` process
			let p = cp.execFile(go, ["doc", "-u", fullName], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						window.showInformationMessage("The 'go' command is not available.");
					}
					if (err) return resolve(null);
					var result = new SignatureHelp();
					let lines = stdout.toString().split('\n');
					
					let funcLineIndex = lines.findIndex(line => line.startsWith("func "));
					var functionDocumentation = "";
					var sep = "";
					
					if (lines.length > (funcLineIndex + 2)) {
						for(var index = funcLineIndex + 2; index < lines.length; index++) {
							if(lines[index].startsWith("    ") == true ) {
								functionDocumentation += sep + lines[index].substring(4);
								sep = ""
							} else {
								break;
							}
						}
					}  
					
					var result = new SignatureHelp();
					let signatureBegin = lines[funcLineIndex].indexOf("(") // func Printf(a ...interface{}) => (a ...interface{})
					var si = new SignatureInformation(lines[funcLineIndex].substring(signatureBegin), functionDocumentation);
					
					result.signatures = [si];
					result.activeSignature = 0;
					result.activeParameter = 0;
					return resolve(result);
				} catch (e) {
					reject(e);
				}
			});
			p.stdin.end(document.getText());
		});
	}
	
	public previousTokens(document: TextDocument, position: Position): Array<string> {
		// Get this from goMain some how
		let wordPattern  = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g;
		let currentLine = document.lineAt(position.line);
		let searchString = currentLine.text.substring(0,position.character);
	
		// TODO: make this clear
		var ret = [];
		for(var results = wordPattern.exec(searchString); results != null; results = wordPattern.exec(searchString)) {
			ret.push(results[0])
		} 

		return ret;
	}
	
	public lastParentheses(document: TextDocument, position: Position): Position {
		var currentLine = document.lineAt(position.line).text.substring(0,position.character);
		
		// TODO: handle double '(('
		for(var index=position.character; currentLine[index] != '('; index--) {
			return new Position(position.line, index);
		}
		return null;
	}
}
