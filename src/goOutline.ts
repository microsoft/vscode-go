/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import {getBinPath} from './goPath'

interface GoOutlineDeclaration {
	label: string;
	type: string;
	icon?: string; // icon class or null to use the default images based on the type
	start: number;
	end: number;
	children?: GoOutlineDeclaration[];
}

class OutlineSupport implements vscode.Modes.IOutlineSupport {

	private goKindToCodeKind: {[key: string]: string} = {
		"package": "module",
		"import": "property",
		"variable": "variable",
		"type": "interface",
		"function": "method"
	}
	
	public getOutline(document: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.Modes.IOutlineEntry[]> {

		return new Promise((resolve, reject) => {
			var filename = document.getUri().fsPath;
			
			var text = document.getText()
			var lines = text.split('\n')
			var lineLengths = lines.map(line => line.length + 1)
			
			var toLineCol = (offset: number) => {
				for(var i = 0; i < lines.length; i++) {
					if(offset < lineLengths[i]) {
						return new vscode.Position(i+1, offset)
					} else {
						offset -= lineLengths[i]
					}
				}
				throw new Error("Illegal offset: " + offset)
			}

			var gooutline = getBinPath("go-outline");

			// Spawn `go-outline` process
			var p = cp.execFile(gooutline, ["-f", filename], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'go-outline' command is not available.  Use 'go get -u github.com/lukehoban/go-outline' to install.");
					}
					if (err) return resolve(null);
					var result = stdout.toString();
					var decls = <GoOutlineDeclaration[]>JSON.parse(result)
					var convert = (decl: GoOutlineDeclaration): vscode.Modes.IOutlineEntry => {
						return <vscode.Modes.IOutlineEntry>{
							label: decl.label,
							type: this.goKindToCodeKind[decl.type],
							range: new vscode.Range(toLineCol(decl.start), toLineCol(decl.end-1)),
							children: decl.children && decl.children.map(convert)
						}
					}
					var ret = decls.map(convert)
					return resolve(ret)				
				} catch(e) {
					reject(e);
				}
			});
		});
	}
}

export = OutlineSupport;