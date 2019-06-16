/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import { getBinPath, getToolsEnvVars, byteOffsetAt } from './util';
import { promptForMissingTool } from './goInstallTools';
import { dirname } from 'path';
import { getAllPackages } from './goPackages';

interface GuruDescribeOutput {
	type: GuruType;
}

interface GuruType {
	type: string;
}

interface GuruWhatOutput {
	enclosing: GuruEnclosing[];
}

interface GuruEnclosing {
	desc: string;
	begin: number;
	end: number;
}

export function implCursor() {
	let workDir = '';
	let currentUri: vscode.Uri = null;
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		currentUri = vscode.window.activeTextEditor.document.uri;
		workDir = dirname(currentUri.fsPath);
	} else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length === 1) {
		currentUri = vscode.workspace.workspaceFolders[0].uri;
		workDir = currentUri.fsPath;
	}

	showAllPackages(workDir);
}

function showAllPackages(workDir: string) {
	getAllPackages(workDir).then(pkgMap => {
		const pkgs: string[] = Array.from(pkgMap.keys());
		if (pkgs.length === 0) {
			return vscode.window.showErrorMessage(
				'Could not find packages. Ensure `gopkgs -format {{.Name}};{{.ImportPath}}` runs successfully.'
			);
		}

		vscode.window.showQuickPick(pkgs.sort(), {
			placeHolder: 'Select a package to browse'
		}).then(showSelectedPackageInterfaces);
	});
}

function showSelectedPackageInterfaces(pkg: string) {
	getPackageDir(pkg)
		.then(runGoInterface)
		.then(interfaces => {
			vscode.window.showQuickPick(interfaces, {
				placeHolder: 'Select interface'
			}).then(chooseReceiverName);
		});
}

function chooseReceiverName(intrfc: string) {
	if (!intrfc) {
		return;
	}

	getTypeAtCursor().then(selectedType => {
		let defaultReceiverName = '';
		if (selectedType) {
			defaultReceiverName = selectedType[0].toLowerCase() + ' *' + selectedType;
		}
		goToEndOfDeclaration();
		vscode.window.showInputBox({
			placeHolder: 'f *File',
			prompt: 'Enter receiver.',
			value: defaultReceiverName
		}).then(implInput => {
			if (!implInput) {
				return;
			}
			runGoImpl(
				[implInput, intrfc],
				vscode.window.activeTextEditor.selection.start
			);
		});
	});
}

function runGoInterface(dir: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const gointerface = getBinPath('gointerfaces');
		cp.execFile(
			gointerface,
			[dir],
			{
				env: getToolsEnvVars(),
				cwd: dirname(vscode.window.activeTextEditor.document.fileName)
			},
			(err, stdout, stderr) => {
				if (err) {
					if ((<any>err).code === 'ENOENT') {
						promptForMissingTool('gointerfaces');
						return;
					}
					vscode.window.showInformationMessage(
						`Cannot find interfaces: ${stderr}`
					);
				}
				resolve(
					stdout.toString().split('\n').filter(l => l.trim().length !== 0)
				);
			}
		);
	});
}

function runGoImpl(args: string[], insertPos: vscode.Position) {
	const goimpl = getBinPath('impl');
	const p = cp.execFile(
		goimpl,
		args,
		{
			env: getToolsEnvVars(),
			cwd: dirname(vscode.window.activeTextEditor.document.fileName)
		},
		(err, stdout, stderr) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool('impl');
				return;
			}

			if (err) {
				vscode.window.showInformationMessage(
					`Cannot stub interface: ${stderr}`
				);
				return;
			}

			vscode.window.activeTextEditor.edit(editBuilder => {
				editBuilder.insert(insertPos, '\n' + stdout);
			});
		}
	);
	if (p.pid) {
		p.stdin.end();
	}
}

/**
 * Return the directory of the given package
 */
function getPackageDir(pkg: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const goRuntimePath = getBinPath('go');
		if (!goRuntimePath) {
			return [];
		}
		cp.execFile(
			goRuntimePath,
			['list', '-f', '{{.Dir}}', pkg],
			null,
			(err, stdout, stderr) => {
				if (!stdout) {
					return;
				}
				resolve(stdout.toString().trim());
			}
		);
	});
}

/**
 * Return the name of type at the cursor position
 */
function getTypeAtCursor(): Promise<string> {
	return new Promise((resolve, reason) => {
		const position = vscode.window.activeTextEditor.selection.start;
		const filename = vscode.window.activeTextEditor.document.fileName;
		const offset = byteOffsetAt(
			vscode.window.activeTextEditor.document,
			position
		);

		const goGuru = getBinPath('guru');
		cp.execFile(
			goGuru,
			['-json', 'describe', `${filename}:#${offset.toString()}`],
			null,
			(err, stdout, stderr) => {
				if (!stdout) {
					resolve('');
					return;
				}
				const guruOutput = <GuruDescribeOutput>(
					JSON.parse(stdout.toString())
				);

				const resType = guruOutput.type.type;
				if (!resType.startsWith('struct{')) {
					resolve(guruOutput.type.type);
					return;
				}
				resolve('');
			}
		);
	});
}

/**
 * If the cursor is on a type declaration, move it after the declaration
 */
function goToEndOfDeclaration() {

	const position = vscode.window.activeTextEditor.selection.start;
	const filename = vscode.window.activeTextEditor.document.fileName;
	const offset = byteOffsetAt(
		vscode.window.activeTextEditor.document,
		position
	);

	const goGuru = getBinPath('guru');
	cp.execFile(
		goGuru,
		['-json', 'what', `${filename}:#${offset.toString()}`],
		null,
		(err, stdout, stderr) => {
			if (!stdout) {
				return;
			}
			const guruOutput = <GuruWhatOutput>JSON.parse(stdout.toString());
			for (const enclosing of guruOutput.enclosing) {
				if (enclosing.desc === 'type declaration') {
					let newPosition = vscode.window.activeTextEditor.document.positionAt(
						enclosing.end
					);
					newPosition = newPosition.with(newPosition.line + 1);
					const newSelection = new vscode.Selection(
						newPosition,
						newPosition
					);
					vscode.window.activeTextEditor.selection = newSelection;
				}
			}
		}
	);
}
