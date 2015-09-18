/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');

class ReferenceSupport implements vscode.Modes.IReferenceSupport {

	private modelService: vscode.Services.IModelService;

	constructor(modelService: vscode.Services.IModelService) {
		this.modelService = modelService;
	}

	public findReferences(resource:vscode.Uri, position:vscode.IPosition, includeDeclaration:boolean, token: vscode.CancellationToken): Thenable<vscode.Modes.IReference[]> {
		return vscode.workspace.anyDirty().then(anyDirty => {
			if (anyDirty) {
				vscode.workspace.saveAll(false).then(() => {
					return this.doFindReferences(resource, position, includeDeclaration, token);
				});
			}
			return this.doFindReferences(resource, position, includeDeclaration, token);
		});
	}

	private doFindReferences(resource:vscode.Uri, position:vscode.IPosition, includeDeclaration:boolean, token: vscode.CancellationToken): Thenable<vscode.Modes.IReference[]> {
		return new Promise((resolve, reject) => {
			var filename = this.canonicalizeForWindows(resource.fsPath);
			var cwd = path.dirname(filename)
			var model = this.modelService.getModel(resource);

			// get current word
			var wordAtPosition = model.getWordAtPosition(position);

			// compute the file offset for position
			var offset = model.getValueInRange({
				startLineNumber: 0,
				startColumn: 0,
				endLineNumber: position.lineNumber,
				endColumn: position.column
			}).length;

			var gofindreferences = path.join(process.env["GOPATH"], "bin", "go-find-references");

			cp.execFile(gofindreferences, ["-file", filename, "-offset", offset.toString()], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						vscode.shell.showInformationMessage("The 'go-find-references' command is not available.  Use 'go get -v github.com/redefiance/go-find-references' to install.");
						return resolve(null);
					}
					if (err) return reject("Cannot find references due to errors: " + err);

					var lines = stdout.toString().split('\n');
					var results: vscode.Modes.IReference[] = [];
					for(var i = 0; i < lines.length; i+=2) {
						var line = lines[i];
						var match = /(.*):(\d+):(\d+)/.exec(lines[i]);
						if(!match) continue;
						var [_, file, lineStr, colStr] = match;
						var referenceResource = vscode.Uri.file(path.resolve(cwd, file));
						results.push({
							resource: referenceResource,
							range: {
								startLineNumber: +lineStr,
								startColumn: +colStr,
								endLineNumber: +lineStr,
								endColumn: +colStr + wordAtPosition.endColumn - wordAtPosition.startColumn
							}
						});
					}
					resolve(results);
				} catch(e) {
					reject(e);
				}
			});
		});
	}

	private canonicalizeForWindows(filename:string):string {
		// convert backslashes to forward slashes on Windows
		// otherwise go-find-references returns no matches
		if (/^[a-z]:\\/.test(filename))
			return filename.replace(/\\/g, '/');
		return filename;
	}

}

export = ReferenceSupport