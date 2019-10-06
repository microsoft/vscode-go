/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { parseFilePrelude, getImportPath, getBinPath, getToolsEnvVars, sendTelemetryEvent } from './util';
import { documentSymbols, GoOutlineImportsOptions } from './goOutline';
import { promptForMissingTool } from './goInstallTools';
import { getImportablePackages } from './goPackages';
import { envPath } from './goPath';

const missingToolMsg = 'Missing tool: ';

export async function listPackages(excludeImportedPkgs: boolean = false): Promise<string[]> {
	const importedPkgs = excludeImportedPkgs && vscode.window.activeTextEditor
		? await getImports(vscode.window.activeTextEditor.document)
		: [];
	const pkgMap = await getImportablePackages(vscode.window.activeTextEditor.document.fileName, true);

	return Array.from(pkgMap.keys())
		.filter(pkg => !importedPkgs.some(imported => imported === pkg))
		.sort();
}

/**
 * Returns the imported packages in the given file
 *
 * @param document TextDocument whose imports need to be returned
 * @returns Array of imported package paths wrapped in a promise
 */
async function getImports(document: vscode.TextDocument): Promise<string[]> {
	const options = { fileName: document.fileName, importsOption: GoOutlineImportsOptions.Only, document };
	const symbols = await documentSymbols(options, null);
	if (!symbols || !symbols.length) {
		return [];
	}
	// import names will be of the form "math", so strip the quotes in the beginning and the end
	const imports = symbols[0].children
		.filter((x: any) => x.kind === vscode.SymbolKind.Namespace)
		.map((x: any) => x.name.substr(1, x.name.length - 2));
	return imports;
}

async function askUserForImport(): Promise<string> {
	try {
		const packages = await listPackages(true);
		return vscode.window.showQuickPick(packages);
	} catch (err) {
		if (typeof err === 'string' && err.startsWith(missingToolMsg)) {
			promptForMissingTool(err.substr(missingToolMsg.length));
		}
	}
}

export function getTextEditForAddImport(arg: string): vscode.TextEdit[] {
	// Import name wasn't provided
	if (arg === undefined) {
		return null;
	}

	const { imports, pkg } = parseFilePrelude(vscode.window.activeTextEditor.document.getText());
	if (imports.some(block => block.pkgs.some(pkgpath => pkgpath === arg))) {
		return [];
	}

	const multis = imports.filter(x => x.kind === 'multi');
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

export function addImport(arg: {importPath: string, from: string}) {
	const p = (arg && arg.importPath) ? Promise.resolve(arg.importPath) : askUserForImport();
	p.then(imp => {
		/* __GDPR__
		"addImportCmd" : {
			"from" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
		}
		*/
		sendTelemetryEvent('addImportCmd', { from: (arg && arg.from) || 'cmd'});
		const edits = getTextEditForAddImport(imp);
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
		const selectedText = editor.document.lineAt(selection.active.line).text;
		importPath = getImportPath(selectedText);
	}

	if (importPath === '') {
		vscode.window.showErrorMessage('No import path to add');
		return;
	}

	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		vscode.window.showErrorMessage(`Failed to run "go list" to find the package as the "go" binary cannot be found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`);
		return;
	}
	const env = getToolsEnvVars();

	cp.execFile(goRuntimePath, ['list', '-f', '{{.Dir}}', importPath], { env }, (err, stdout, stderr) => {
		const dirs = (stdout || '').split('\n');
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
