/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

function vscodeTypeFromGoCodeClass(kind: string): string {
	switch (kind) {
		case "const":
		case "package":
		case "type":
			return 'keyword';
		case "func":
			return 'function';
		case "var":
			return 'field';
	}
	return kind;
}

interface GoCodeSuggestion {
	class: string;
	name: string;
	type: string;
}

class SuggestSupport implements vscode.Modes.ISuggestSupport {

	public triggerCharacters = ['.'];
	public excludeTokens = ['string', 'comment', 'numeric'];

	public suggest(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Modes.ISuggestions[]> {
		return new Promise((resolve, reject) => {
			var filename = document.getUri().fsPath;

			// get current word
			var wordAtPosition = document.getWordRangeAtPosition(position);
			var currentWord = '';
			if (wordAtPosition && wordAtPosition.start.character < position.character) {
				var word = document.getTextInRange(wordAtPosition);
				currentWord = word.substr(0, position.character - wordAtPosition.start.character);
			}

			// compute the file offset for position
			var range = new vscode.Range(0, 0, position.line, position.character);
			var offset = document.getTextInRange(range).length;

			var gocode = path.join(process.env["GOPATH"], "bin", "gocode");

			// Spawn `gocode` process
			var p = cp.execFile(gocode, ["-f=json", "autocomplete", filename, "" + offset], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.window.showInformationMessage("The 'gocode' command is not available.  Use 'go get -u github.com/nsf/gocode' to install.");
					}
					if (err) return reject(err);
					var results = <[number, GoCodeSuggestion[]]>JSON.parse(stdout.toString());
					var suggestions = results[1].map(suggest => {
						return {
							label: suggest.name,
							typeLabel: (suggest.class == "func" ? suggest.type.substring(4) : suggest.type),
							codeSnippet: suggest.name,
							type: vscodeTypeFromGoCodeClass(suggest.class)
						};
					})
					resolve([{ currentWord, suggestions }]);
				} catch(e) {
					reject(e);
				}
			});
			p.stdin.end(document.getText());

		});
	}
}

export = SuggestSupport;