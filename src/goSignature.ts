/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath'
//import { GoHoverProvider } from './goExtraInfo'
import { GoScanner } from './goScanner'
import { languages, window, SignatureHelpProvider, SignatureHelp, SignatureInformation, ParameterInformation, TextDocument, Position, CancellationToken } from 'vscode';

export class GoSignatureHelpProvider implements SignatureHelpProvider {
	public provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): Promise<SignatureHelp> {
		return new Promise((resolve, reject) => {
			
			// Experimental support, works only on standard library for now
			let pkgName = GoScanner.PreviousToken(document,position);

			let funcOffset = document.offsetAt(position);
			let funcPosition = document.positionAt(funcOffset - 1);
			let funcWordPosition = document.getWordRangeAtPosition(funcPosition);
			let functionName = document.getText(funcWordPosition);
			
			// Get the package name
			let pkgPosition = new Position(funcWordPosition.start.line, funcWordPosition.start.character - 2);
			let pkgWordPosition = document.getWordRangeAtPosition(pkgPosition);
			let packageName = document.getText(pkgWordPosition);
			
			// TODO: figure a cleaner way to do this
			let fullName = packageName + "." + functionName
			
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
								sep = "<br />"
							} else {
								break;
							}
						}
					}  
					
					
					
					var result = new SignatureHelp();
					var si = new SignatureInformation(lines[funcLineIndex], functionDocumentation);
					
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
}
