
import { TextDocument, Position } from 'vscode';

export function byteOffsetAt(document: TextDocument, position: Position): number {
	let offset = document.offsetAt(position);
	let text = document.getText();
	let byteOffset = 0;
	for(let i = 0; i < offset; i ++) {
		let clen = Buffer.byteLength(text[i]);
		byteOffset += clen;
	}
	return byteOffset;
}