/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');

function monacoTypeFromGoCodeClass(kind: string): string {
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

	private modelService: vscode.Services.IModelService;

	constructor(modelService: vscode.Services.IModelService) {
		this.modelService = modelService;
	}

	public suggest(resource: vscode.URI, position: vscode.IPosition, token: vscode.CancellationToken): Promise<vscode.Modes.ISuggestions[]> {
		return new Promise((resolve, reject) => {
			var path = resource.fsPath;
			var model = this.modelService.getModel(resource);

			// get current word
			var wordAtPosition = model.getWordAtPosition(position);
			var currentWord = '';
			if (wordAtPosition && wordAtPosition.startColumn < position.column) {
				currentWord = wordAtPosition.word.substr(0, position.column - wordAtPosition.startColumn);
			}

			// compute the file offset for position
			var offset = position.column - 1;
			for (var row = 1; row < position.lineNumber; row++) {
				offset += model.getLineMaxColumn(row);
			}

			// Spawn `gocode` process
			var process = cp.execFile("gocode", ["-f=json", "autocomplete", path, "c" + offset], {}, (err, stdout, stderr) => {
				try {
					if (err) return reject(err);
					var results = <[number, GoCodeSuggestion[]]>JSON.parse(stdout.toString());
					var suggestions = results[1].map(suggest => {
						return {
							label: suggest.name,
							typeLabel: (suggest.class == "func" ? suggest.type.substring(4) : suggest.type),
							codeSnippet: suggest.name,
							type: monacoTypeFromGoCodeClass(suggest.class)
						};
					})
					resolve([{ currentWord, suggestions }]);
				} catch(e) {
					reject(e);
				}
			});
			process.stdin.end(model.getValue());

		});
	}
}

export = SuggestSupport;