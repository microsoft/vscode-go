/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import { TextDocument, Position } from 'vscode';

export function byteOffsetAt(document: TextDocument, position: Position): number {
	let offset = document.offsetAt(position);
	let text = document.getText();
	let byteOffset = 0;
	for (let i = 0; i < offset; i++) {
		let clen = Buffer.byteLength(text[i]);
		byteOffset += clen;
	}
	return byteOffset;
}

export interface Prelude {
	imports: Array<{kind: string; start: number; end: number;}>;
	pkg: {start: number; end: number;};
}

export function parseFilePrelude(text: string): Prelude {
	let lines = text.split('\n');
	let ret: Prelude = {imports: [], pkg: null };
	for (var i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (line.match(/^(\s)*package(\s)+/)) {
			ret.pkg = {start: i, end: i};
		}
		if (line.match(/^(\s)*import(\s)+\(/)) {
			ret.imports.push({kind: "multi", start: i, end: -1});
		}
		if (line.match(/^(\s)*import(\s)+[^\(]/)) {
			ret.imports.push({kind: "single", start: i, end: i});
		}
		if (line.match(/^(\s)*\)/)) {
			if(ret.imports[ret.imports.length - 1].end == -1) {
				ret.imports[ret.imports.length - 1].end = i;
			}
		}
		if (line.match(/^(\s)*(func|const|type|var)/)) {
			break;
		}
	}
	return ret;
}

// Takes a Go function signature like:
//     (foo, bar string, baz number) (string, string) 
// and returns an array of parameter strings:
//     ["foo", "bar string", "baz string"]
// Takes care of balancing parens so to not get confused by signatures like:
//     (pattern string, handler func(ResponseWriter, *Request)) {
export function parameters(signature: string): string[] {
		var ret: string[] = [];
		var parenCount = 0;
		var lastStart = 1;
		for (var i = 1; i < signature.length; i++) {
			switch (signature[i]) {
				case '(':
					parenCount++;
					break;
				case ')':
					parenCount--;
					if (parenCount < 0) {
						if (i > lastStart) {
							ret.push(signature.substring(lastStart, i));
						}
						return ret;
					}
					break;
				case ',':
					if (parenCount == 0) {
						ret.push(signature.substring(lastStart, i));
						lastStart = i + 2;
					}
					break;
			}
		}
		return null;
	}
