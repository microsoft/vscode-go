/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import {window, HoverProvider, Hover, TextDocument, Position, Range, CancellationToken} from 'vscode';
import cp = require('child_process');
import path = require('path');

export class GoHoverProvider implements HoverProvider {

	public provideHover(document: TextDocument, position: Position, token: CancellationToken): Thenable<Hover> {

		return new Promise((resolve, reject) => {
            let filename = document.fileName;
			let offset = document.offsetAt(position);

			let godef = path.join(process.env["GOPATH"], "bin", "godef");

			// Spawn `godef` process
			let p = cp.execFile(godef, ["-t", "-i", "-f", filename, "-o", offset.toString()], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						window.showInformationMessage("The 'godef' command is not available.  Use 'go get -u github.com/rogpeppe/godef' to install.");
					}
					if (err) return resolve(null);
					let result = stdout.toString();
					let lines = result.split('\n');
					if(lines.length > 10) lines[9] = "...";
					let text = lines.slice(1,10).join('\n');
					text = text.replace(/\n+$/,'');
					
                    let hover = new Hover({ language: 'go', value: text });
					return resolve(hover);
				} catch(e) {
					reject(e);
				}
			});
			p.stdin.end(document.getText());
		});
	}
}
