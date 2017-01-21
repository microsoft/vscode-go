/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { parseFilePrelude, isVendorSupported, getBinPath } from './util';
import { documentSymbols } from './goOutline';
import { promptForMissingTool } from './goInstallTools';
import path = require('path');

export function listPackages(excludeImportedPkgs: boolean = false): Thenable<string[]> {
	let importsPromise = excludeImportedPkgs && vscode.window.activeTextEditor ? getImports(vscode.window.activeTextEditor.document.fileName) : Promise.resolve([]);
	let vendorSupportPromise = isVendorSupported();
	let goPkgsPromise = new Promise<string[]>((resolve, reject) => {
		cp.execFile(getBinPath('gopkgs'), [], (err, stdout, stderr) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool('gopkgs');
				return reject();
			}
			let lines = stdout.toString().split('\n');
			if (lines[lines.length - 1] === '') {
				// Drop the empty entry from the final '\n'
				lines.pop();
			}
			return resolve(lines);
		});
	});

	return vendorSupportPromise.then((vendorSupport: boolean) => {
		return Promise.all<string[]>([goPkgsPromise, importsPromise]).then(values => {
			let pkgs = values[0];
			let importedPkgs = values [1];

			if (!vendorSupport) {
				if (importedPkgs.length > 0) {
					pkgs = pkgs.filter(element => {
						return importedPkgs.indexOf(element) === -1;
					});
				}
				return pkgs.sort();
			}

			let currentFileDirPath = path.dirname(vscode.window.activeTextEditor.document.fileName);
			let workspaces: string[] = process.env['GOPATH'].split(path.delimiter);
			let currentWorkspace = path.join(workspaces[0], 'src');

			// Workaround for issue in https://github.com/Microsoft/vscode/issues/9448#issuecomment-244804026
			if (process.platform === 'win32') {
				currentFileDirPath = currentFileDirPath.substr(0, 1).toUpperCase() + currentFileDirPath.substr(1);
			}

			// In case of multiple workspaces, find current workspace by checking if current file is
			// under any of the workspaces in $GOPATH
			for (let i = 1; i < workspaces.length; i++) {
				let possibleCurrentWorkspace = path.join(workspaces[i], 'src');
				if (currentFileDirPath.startsWith(possibleCurrentWorkspace)) {
					// In case of nested workspaces, (example: both /Users/me and /Users/me/src/a/b/c are in $GOPATH)
					// both parent & child workspace in the nested workspaces pair can make it inside the above if block
					// Therefore, the below check will take longer (more specific to current file) of the two
					if (possibleCurrentWorkspace.length > currentWorkspace.length) {
						currentWorkspace = possibleCurrentWorkspace;
					}
				}
			}

			let pkgSet = new Set<string>();
			pkgs.forEach(pkg => {
				if (!pkg || importedPkgs.indexOf(pkg) > -1) {
					return;
				}

				let magicVendorString = '/vendor/';
				let vendorIndex = pkg.indexOf(magicVendorString);
				if (vendorIndex === -1) {
					magicVendorString = 'vendor/';
					if (pkg.startsWith(magicVendorString)) {
						vendorIndex = 0;
					}
				}
				// Check if current file and the vendor pkg belong to the same root project
				// If yes, then vendor pkg can be replaced with its relative path to the "vendor" folder
				// If not, then the vendor pkg should not be allowed to be imported.
				if (vendorIndex > -1) {
					let rootProjectForVendorPkg = path.join(currentWorkspace, pkg.substr(0, vendorIndex));
					let relativePathForVendorPkg = pkg.substring(vendorIndex + magicVendorString.length);

					if (relativePathForVendorPkg && currentFileDirPath.startsWith(rootProjectForVendorPkg)) {
						pkgSet.add(relativePathForVendorPkg);
					}
					return;
				}

				// pkg is not a vendor project
				pkgSet.add(pkg);
			});

			return Array.from(pkgSet).sort();
		});
	});
}

/**
 * Returns the imported packages in the given file
 *
 * @param fileName File system path of the file whose imports need to be returned
 * @returns Array of imported package paths wrapped in a promise
 */
function getImports(fileName: string): Promise<string[]> {
	let options = { fileName: fileName, importsOnly: true };
	return documentSymbols(options).then(symbols => {
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
		if (edit) {
			vscode.window.activeTextEditor.edit(editBuilder => {
				editBuilder.insert(edit.range.start, edit.newText);
			});
		}
	});
}