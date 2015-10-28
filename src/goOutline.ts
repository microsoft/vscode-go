/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

interface GoOutlineDeclaration {
	label: string;
	type: string;
	icon?: string; // icon class or null to use the default images based on the type
	start: number;
	end: number;
	children?: GoOutlineDeclaration[];
}

export class GoDocumentSybmolProvider implements vscode.DocumentSymbolProvider {

	private goKindToCodeKind: { [key: string]: vscode.SymbolKind } = {
		"package": vscode.SymbolKind.Package,
		"import": vscode.SymbolKind.Namespace,
		"variable": vscode.SymbolKind.Variable,
		"type": vscode.SymbolKind.Interface,
		"function": vscode.SymbolKind.Function
	}

	public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {

		return new Promise((resolve, reject) => {
			var filename = document.getUri().fsPath;

			var text = document.getText();
			var lines = text.split('\n');
			var lineLengths = lines.map(line => line.length + 1);

			var toLineCol = (offset: number) => {
				for (var i = 0; i < lines.length; i++) {
					if (offset < lineLengths[i]) {
						return new vscode.Position(i, offset)
					} else {
						offset -= lineLengths[i]
					}
				}
				throw new Error("Illegal offset: " + offset)
			}

			var convertToCodeSymbols = (decl: GoOutlineDeclaration[], symbols: vscode.SymbolInformation[]): void => {
				decl.forEach((each) => {
					symbols.push(
						new vscode.SymbolInformation(
							each.label,
							this.goKindToCodeKind[each.type],
							new vscode.Range(toLineCol(each.start), toLineCol(each.end - 1))
						)
					);
					if (each.children) {
						convertToCodeSymbols(each.children, symbols);
					}
				})
			}

			var gooutline = path.join(process.env["GOPATH"], "bin", "go-outline");

			// Spawn `go-outline` process
			var p = cp.execFile(gooutline, ["-f", filename], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'go-outline' command is not available.  Use 'go get -u github.com/lukehoban/go-outline' to install.");
					}
					if (err) return resolve(null);
					var result = stdout.toString();
					var decls = <GoOutlineDeclaration[]>JSON.parse(result);
					var symbols: vscode.SymbolInformation[] = [];
					convertToCodeSymbols(decls, symbols);
					return resolve(symbols)
				} catch (e) {
					reject(e);
				}
			});
		});
	}
}