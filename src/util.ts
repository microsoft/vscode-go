
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
			ret.imports[ret.imports.length - 1].end = i;
		}
		if (line.match(/^(\s)(func|const|type|var)/)) {
			break;
		}
	}
	return ret;
}
