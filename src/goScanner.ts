
import cp = require('child_process');
import path = require('path');
import { getBinPath } from './goPath'
import { GoHoverProvider } from './goExtraInfo'
import { languages, window, SignatureHelpProvider, SignatureHelp, SignatureInformation, ParameterInformation, TextDocument, Position, CancellationToken } from 'vscode';
import vscode = require('vscode');


export class GoScanner {
	public static PreviousToken(document: TextDocument, position: Position): string {
		// Get this from goMain some how
		let wordPattern  = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g;
		let currentLine = document.lineAt(position.line);
		let results = wordPattern.exec(currentLine.text.substring(0,position.character));
		return results[results.length - 1];
	}
}


