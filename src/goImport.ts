/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { parseFilePrelude, getImportPath, getBinPath, getToolsEnvVars } from './util';
import { documentSymbols } from './goOutline';
import { promptForMissingTool } from './goInstallTools';
import { getImportablePackages } from './goPackages';
import { isModSupported } from './goModules';

const missingToolMsg = 'Missing tool: ';

export function listPackages(excludeImportedPkgs: boolean = false): Thenable<string[]> {
	let importsPromise = excludeImportedPkgs && vscode.window.activeTextEditor ? getImports(vscode.window.activeTextEditor.document) : Promise.resolve([]);
	let pkgsPromise = isModSupported(vscode.window.activeTextEditor.document.uri).then(isMod => {
		return getImportablePackages(vscode.window.activeTextEditor.document.fileName, isMod, true);
	});

	return Promise.all([pkgsPromise, importsPromise]).then(([pkgMap, importedPkgs]) => {
		importedPkgs.forEach(pkg => {
			pkgMap.delete(pkg);
		});
		return Array.from(pkgMap.keys()).sort();
	});
}

/**
 * Returns the imported packages in the given file
 *
 * @param document TextDocument whose imports need to be returned
 * @returns Array of imported package paths wrapped in a promise
 */
function getImports(document: vscode.TextDocument): Promise<string[]> {
	let options = { fileName: document.fileName, importsOnly: true, document };
	return documentSymbols(options, null).then(symbols => {
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
	}, err => {
		if (typeof err === 'string' && err.startsWith(missingToolMsg)) {
			promptForMissingTool(err.substr(missingToolMsg.length));
		}
	});
}

export function getTextEditForAddImport(arg: string): vscode.TextEdit[] {
	// Import name wasn't provided
	if (arg === undefined) {
		return null;
	}

	let { imports, pkg } = parseFilePrelude(vscode.window.activeTextEditor.document.getText());
	if (imports.some(block => block.pkgs.some(pkgpath => pkgpath === arg))) {
		return [];
	}

	let multis = imports.filter(x => x.kind === 'multi');
	if (multis.length > 0) {
		// There is a multiple import declaration, add to the last one
		const lastImportSection = multis[multis.length - 1];
		if (lastImportSection.end === -1) {
			// For some reason there was an empty import section like `import ()`
			return [vscode.TextEdit.insert(new vscode.Position(lastImportSection.start + 1, 0), `import "${arg}"\n`)];
		}
		// Add import at the start of the block so that goimports/goreturns can order them correctly
		return [vscode.TextEdit.insert(new vscode.Position(lastImportSection.start + 1, 0), '\t"' + arg + '"\n')];
	} else if (imports.length > 0) {
		// There are some number of single line imports, which can just be collapsed into a block import.
		const edits = [];

		edits.push(vscode.TextEdit.insert(new vscode.Position(imports[0].start, 0), 'import (\n\t"' + arg + '"\n'));
		imports.forEach(element => {
			const currentLine = vscode.window.activeTextEditor.document.lineAt(element.start).text;
			const updatedLine = currentLine.replace(/^\s*import\s*/, '\t');
			edits.push(vscode.TextEdit.replace(new vscode.Range(element.start, 0, element.start, currentLine.length), updatedLine));
		});
		edits.push(vscode.TextEdit.insert(new vscode.Position(imports[imports.length - 1].end + 1, 0), ')\n'));

		return edits;

	} else if (pkg && pkg.start >= 0) {
		// There are no import declarations, but there is a package declaration
		return [vscode.TextEdit.insert(new vscode.Position(pkg.start + 1, 0), '\nimport (\n\t"' + arg + '"\n)\n')];
	} else {
		// There are no imports and no package declaration - give up
		return [];
	}
}

export function addImport(arg: string) {
	let p = arg ? Promise.resolve(arg) : askUserForImport();
	p.then(imp => {
		let edits = getTextEditForAddImport(imp);
		if (edits && edits.length > 0) {
			const edit = new vscode.WorkspaceEdit();
			edit.set(vscode.window.activeTextEditor.document.uri, edits);
			vscode.workspace.applyEdit(edit);
		}
	});
}

export function addImportToWorkspace() {
	const editor = vscode.window.activeTextEditor;
	const selection = editor.selection;

	let importPath = '';
	if (!selection.isEmpty) {
		let selectedText = editor.document.getText(selection).trim();
		if (selectedText.length > 0) {
			if (selectedText.indexOf(' ') === -1) {
				// Attempt to load a partial import path based on currently selected text
				if (!selectedText.startsWith('"')) {
					selectedText = '"' + selectedText;
				}
				if (!selectedText.endsWith('"')) {
					selectedText = selectedText + '"';
				}
			}
			importPath = getImportPath(selectedText);
		}
	}

	if (importPath === '') {
		// Failing that use the current line
		let selectedText = editor.document.lineAt(selection.active.line).text;
		importPath = getImportPath(selectedText);
	}

	if (importPath === '') {
		vscode.window.showErrorMessage('No import path to add');
		return;
	}

	const goRuntimePath = getBinPath('go');
	const env = getToolsEnvVars();

	cp.execFile(goRuntimePath, ['list', '-f', '{{.Dir}}', importPath], { env }, (err, stdout, stderr) => {
		let dirs = (stdout || '').split('\n');
		if (!dirs.length || !dirs[0].trim()) {
			vscode.window.showErrorMessage(`Could not find package ${importPath}`);
			return;
		}

		const importPathUri = vscode.Uri.file(dirs[0]);

		const existingWorkspaceFolder = vscode.workspace.getWorkspaceFolder(importPathUri);
		if (existingWorkspaceFolder !== undefined) {
			vscode.window.showInformationMessage('Already available under ' + existingWorkspaceFolder.name);
			return;
		}

		vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null, { uri: importPathUri });
	});
}
