/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import { window, HoverProvider, Hover, TextDocument, Position, Range, CancellationToken } from 'vscode';
import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath'
import { byteOffsetAt } from './util'

export class GoHoverProvider implements HoverProvider {

	public provideHover(document: TextDocument, position: Position, token: CancellationToken): Thenable<Hover> {

		return new Promise((resolve, reject) => {
			let filename = document.fileName;
			let offset = byteOffsetAt(document, position);

			var godef = getBinPath("godef");

			// Spawn `godef` process
			let p = cp.execFile(godef, ["-t", "-i", "-f", filename, "-o", offset.toString()], {}, (err, stdout, stderr) => {
				try {
					if (err && (<any>err).code == "ENOENT") {
						window.showInformationMessage("The 'godef' command is not available.  Use 'go get -u github.com/rogpeppe/godef' to install.");
					}
					if (err) return resolve(null);
					let result = stdout.toString();
					let lines = result.split('\n');
					lines = lines.map(line => {
						if (line.indexOf('\t') == 0) {
							line = line.slice(1)
						}
						return line.replace(/\t/g, '  ')
					});
					lines = lines.filter(line => line.length != 0);
					if (lines.length > 10) lines[9] = "...";
					let text;
					if (lines.length > 1) {
						text = lines.slice(1, 10).join('\n');
						text = text.replace(/\n+$/, '');
					} else {
						text = lines[0]
					}
					let hover = new Hover({ language: 'go', value: text });
					return resolve(hover);
				} catch (e) {
					reject(e);
				}
			});
			p.stdin.end(document.getText());
		});
	}
}
