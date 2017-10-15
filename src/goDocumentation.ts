'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { CancellationToken, TextDocumentContentProvider, Uri } from 'vscode';
import { getBinPath, getToolsEnvVars } from './util';

const missingToolMsg = 'Missing tool: ';

export function getDocumentation(): void {
	// TODO: somehow detect context menu vs. command menu invocation to skip the
	// input box when somebody right-clicks on an identifier in the code.

	vscode.window.showInputBox({
		prompt: "package name or blank to detect with cursor"
	}).then(pkgInput => {
		let pkg;

		if (typeof pkgInput === 'undefined') {
			return;
		}

		if (pkgInput === '') {
			pkg = 'need-to-detect';
			vscode.window.showWarningMessage("location detection not implemented")
		} else {
			pkg = pkgInput;
		}

		let uri = vscode.Uri.parse("godocumentation://");
		uri = uri.with({
			path: pkg,
		})

		vscode.workspace.openTextDocument(
			uri,
		).then(doc => vscode.window.showTextDocument(
			doc, vscode.window.activeTextEditor.viewColumn+1, true),
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
		let vendorPkg = vscode.workspace.workspaceFolders[0].uri.fsPath + "/vendor/" + pkg;

		return new Promise<string>((resolve, reject) => {
			cp.execFile(godoc, [vendorPkg], {env: getToolsEnvVars()}, (err, stdout, stderr) => {
				let output = stdout + stderr;

				let match = /cannot find package/.exec(output);
				if (!match) {
					return resolve(output)
				} else {
					return resolve(new Promise<string>((resolve, reject) => {
						cp.execFile(godoc, [pkg], {env: getToolsEnvVars()}, (err, stdout, stderr) => {
							let output = stdout + stderr

							let match = /cannot find package/.exec(output);
							if (!match) {
								return resolve(output)
							} else {
								return resolve("Could not find package " + pkg)
							}
						})
					}))
				}
			})
		})
	}
}
