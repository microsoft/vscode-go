
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

export function parseFilePrelude(text: string) {
	let lines = text.split('\n');
	let imports = []
	for (var i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (line.match(/^(\s)*import(\s)+\(/)) {
			imports.push({kind: "multi", start: i});
		}
		if (line.match(/^(\s)*import(\s)+[^\(]/)) {
			imports.push({kind: "single", start: i, end: i});
		}
		if (line.match(/^(\s)*\)/)) {
			imports[imports.length - 1].end = i;
		}
		if (line.match(/^(\s)(func|const|type|var)/)) {
			break;
		}
	}
	return imports;
}
