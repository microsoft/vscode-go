'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { CancellationToken, TextDocumentContentProvider, Uri } from 'vscode';
import { getBinPath, getToolsEnvVars, byteOffsetAt, getFileArchive } from './util';

const missingToolMsg = 'Missing tool: ';

export function getDocumentation(): void {
	let gogetdoc = getBinPath('gogetdoc');
	if (!path.isAbsolute(gogetdoc)) {
		vscode.window.showErrorMessage(missingToolMsg + 'gogetdoc');
		return;
	}

	let ate = vscode.window.activeTextEditor;
	if (typeof ate !== 'undefined') {
		let document = ate.document;
		let gogetDocsFlags = ['-u', '-json', '-modified', '-pos', document.fileName + ':#' + byteOffsetAt(document, ate.selection.active).toString()];
		let p = cp.execFile(gogetdoc, gogetDocsFlags, {env: getToolsEnvVars()}, (err, stdout, stderr) => {
			try {
				let goGetDocOutput = <GoGetDocOutput>JSON.parse(stdout.toString());

				// drop the stuff before /vendor/ if we have it
				let imprt = goGetDocOutput.import.replace(/(.*\/vendor\/)?(.*)/, '$2');

				_getDocumentationForImport(imprt);
			} catch (e) {
				_getDocumentationForImport('');
			}
		});
		p.stdin.end(getFileArchive(document));
	} else {
		_getDocumentationForImport('');
	}
}

function _getDocumentationForImport(imprt: string): void {
	vscode.window.showInputBox({
		prompt: 'Please enter a package name',
		value: imprt,
		placeHolder: imprt === '' ? 'no package detected' : '',
	}).then(pkgInput => {
		if (typeof pkgInput === 'undefined' || pkgInput === '') {
			return;
		}

		let uri = vscode.Uri.parse('godocumentation://');
		uri = uri.with({
			path: pkgInput,
		});

		vscode.workspace.openTextDocument(
			uri,
		).then(doc => vscode.window.showTextDocument(
			doc, vscode.window.activeTextEditor.viewColumn + 1, true),
		);
	});
}

export class GoDocumentationContentProvider implements TextDocumentContentProvider {
	public provideTextDocumentContent(uri: Uri, token: CancellationToken): Thenable<string> {
		let godoc = getBinPath('godoc');

		let pkg = uri.path;

		// godoc doesn't handle vendor directories correctly. So we first try
		// the local workspace vendor directory to see if there's a vendored
		// version of the package. If not, we'll return whatever godoc would
		// normally say.
		let vendorPkg = vscode.workspace.workspaceFolders[0].uri.fsPath + '/vendor/' + pkg;

		return new Promise<string>((resolve, reject) => {
			cp.execFile(godoc, [vendorPkg], {env: getToolsEnvVars()}, (err, stdout, stderr) => {
				let output = stdout + stderr;

				let match = /cannot find package/.exec(output);
				if (!match) {
					return resolve(_cleanupGodocOutput(output));
				} else {
					return resolve('');
				}
			});
		}).then(vendorOutput => {
			if (vendorOutput !== '') {
				return vendorOutput;
			}

			return new Promise<string>((resolve, reject) => {
				cp.execFile(godoc, [pkg], {env: getToolsEnvVars()}, (err, stdout, stderr) => {
					let output = stdout + stderr;
					let match = /cannot find package/.exec(output);
					if (!match) {
						return resolve(_cleanupGodocOutput(output));
					} else {
						return resolve('Could not find package ' + pkg);
					}
				});
			});
		});
	}
}

function _cleanupGodocOutput(output: string): string {
	output = output.replace(/.*\n\n(PACKAGE DOCUMENTATION\n\n.*)/, '$1');
	output = output.replace(/import ".*\/vendor\/(.*?)"/, 'import "$1"');
	return output;
}

interface GoGetDocOutput {
	import: string;
}
