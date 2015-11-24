/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath'

function vscodeKindFromGoCodeClass(kind: string): vscode.CompletionItemKind {
	switch (kind) {
		case "const":
		case "package":
		case "type":
			return vscode.CompletionItemKind.Keyword;
		case "func":
			return vscode.CompletionItemKind.Function;
		case "var":
			return vscode.CompletionItemKind.Field;
	}
	return vscode.CompletionItemKind.Property; // TODO@EG additional mappings needed?
}

interface GoCodeSuggestion {
	class: string;
	name: string;
	type: string;
}

export class GoCompletionItemProvider implements vscode.CompletionItemProvider {

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CompletionItem[]> {
		return new Promise((resolve, reject) => {
			var filename = document.fileName;

			// get current word
			var wordAtPosition = document.getWordRangeAtPosition(position);
			var currentWord = '';
			if (wordAtPosition && wordAtPosition.start.character < position.character) {
				var word = document.getText(wordAtPosition);
				currentWord = word.substr(0, position.character - wordAtPosition.start.character);
			}

			var offset = document.offsetAt(position);
			var gocode = getBinPath("gocode");

			// Spawn `gocode` process
			var p = cp.execFile(gocode, ["-f=json", "autocomplete", filename, "c" + offset], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'gocode' command is not available.  Use 'go get -u github.com/nsf/gocode' to install.");
					}
					if (err) return reject(err);
					var results = <[number, GoCodeSuggestion[]]>JSON.parse(stdout.toString());
					var suggestions = results[1].map(suggest => {
						var item = new vscode.CompletionItem(suggest.name);
                        item.kind = vscodeKindFromGoCodeClass(suggest.class);
                        item.detail = suggest.type;
						return item;
					})
					resolve(suggestions);
				} catch (e) {
					reject(e);
				}
			});
			p.stdin.end(document.getText());
		});
	}
}