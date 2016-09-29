/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath } from './goPath';
import { parseFilePrelude } from './util';
import { promptForMissingTool } from './goInstallTools';
import { documentSymbols } from './goOutline';

export function listPackages(excludeImportedPkgs: boolean = false): Thenable<string[]> {
	let importsPromise = excludeImportedPkgs && vscode.window.activeTextEditor ? getImports(vscode.window.activeTextEditor.document.fileName) : Promise.resolve([]);
	let pkgsPromise = new Promise<string[]>((resolve, reject) => {
		cp.execFile(getBinPath('gopkgs'), [], (err, stdout, stderr) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool('gopkgs');
				return reject();
			}
			let lines = stdout.toString().split('\n');
			let sortedlines = lines.sort().slice(1); // Drop the empty entry from the final '\n'
			return resolve(sortedlines);
		});
	});

	return Promise.all<string[]>([importsPromise, pkgsPromise]).then(values => {
		let imports = values[0];
		let pkgs = values[1];
		if (imports.length === 0) {
			return pkgs;
		}
		return pkgs.filter(element => {
			return imports.indexOf(element) === -1;
		});
	});
}

/**
 * Returns the imported packages in the given file
 *
 * @param fileName File system path of the file whose imports need to be returned
 * @returns Array of imported package paths wrapped in a promise
 */
export function getImports(fileName: string): Promise<string[]> {
	return documentSymbols(fileName).then(symbols => {
		if (!symbols || !symbols[0] || !symbols[0].children) {
			return [];
		}
		// imports will be of the form { type: 'import', label: '"math"'}
		let imports = symbols[0].children.filter(x => x.type === 'import').map(x => x.label.substr(1, x.label.length - 2));
		return imports;
	});
}

function askUserForImport(): Thenable<string> {
	return listPackages(true).then(packages => {
		return vscode.window.showQuickPick(packages);
	});
}

export function getTextEditForAddImport(arg: string): vscode.TextEdit {
	// Import name wasn't provided
	if (arg === undefined) {
		return null;
	}

	let {imports, pkg} = parseFilePrelude(vscode.window.activeTextEditor.document.getText());
	let multis = imports.filter(x => x.kind === 'multi');
	if (multis.length > 0) {
		// There is a multiple import declaration, add to the last one
		let closeParenLine = multis[multis.length - 1].end;
		return vscode.TextEdit.insert(new vscode.Position(closeParenLine, 0), '\t"' + arg + '"\n');
	} else if (imports.length > 0) {
		// There are only single import declarations, add after the last one
		let lastSingleImport = imports[imports.length - 1].end;
		return vscode.TextEdit.insert(new vscode.Position(lastSingleImport + 1, 0), 'import "' + arg + '"\n');
	} else if (pkg && pkg.start >= 0) {
		// There are no import declarations, but there is a package declaration
		return vscode.TextEdit.insert(new vscode.Position(pkg.start + 1, 0), '\nimport (\n\t"' + arg + '"\n)\n');
	} else {
		// There are no imports and no package declaration - give up
		return null;
	}
}

export function addImport(arg: string) {
	let p = arg ? Promise.resolve(arg) : askUserForImport();
	p.then(imp => {
		let edit = getTextEditForAddImport(imp);
		vscode.window.activeTextEditor.edit(editBuilder => {
			editBuilder.insert(edit.range.start, edit.newText);
		});
	});
}