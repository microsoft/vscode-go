'use strict';

import vscode = require('vscode');

export let coveredGutter
export let uncoveredGutter

export function initGutterDecorators(ctx: vscode.ExtensionContext) {
	coveredGutter = vscode.window.createTextEditorDecorationType({
		// Gutter green
		gutterIconPath: ctx.asAbsolutePath("images/gutter-green.svg")
	});
	uncoveredGutter = vscode.window.createTextEditorDecorationType({
		// Gutter red
		gutterIconPath: ctx.asAbsolutePath("images/gutter-red.svg")
	});
}