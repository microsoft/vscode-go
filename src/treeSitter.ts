import vscode = require('vscode');
import {tree, decoration, range} from 'vscode-tree-sitter';
import {colorGo} from './treeSitterColor';

export function color(editor: vscode.TextEditor) {
	try {
		if (editor.document.languageId !== 'go') return;
		const visibleRanges = editor.visibleRanges.map(range => {
			const start = range.start.line;
			const end = range.end.line;
			return {start, end};
		});
		const t = tree(editor.document.uri);
		if (t == null) {
			console.warn(editor.document.uri.path, 'has not been parsed');
			return;
		}
		const colors = colorGo(t.rootNode, visibleRanges);
		for (const scope of Object.keys(colors)) {
			const dec = decoration(scope);
			if (!dec) continue;
			const ranges = colors[scope]!.map(range);
			editor.setDecorations(dec, ranges);
		}
	} catch (e) {
		console.error(e);
	}
}
