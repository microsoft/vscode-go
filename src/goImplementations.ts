'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { byteOffsetAt, getBinPath, canonicalizeGOPATHPrefix, getWorkspaceFolderPath } from './util';
import { promptForMissingTool } from './goInstallTools';
import { getToolsEnvVars } from './util';
import { getGoRuntimePath } from './goPath';

interface GoListOutput {
	Dir: string;
	ImportPath: string;
	Root: string;
}

interface GuruImplementsRef {
	name: string;
	pos: string;
	kind: string;
}

interface GuruImplementsOutput {
	type: GuruImplementsRef;
	to: GuruImplementsRef[];
	to_method: GuruImplementsRef[];
	from: GuruImplementsRef[];
	fromptr: GuruImplementsRef[];
}

export class GoImplementationProvider implements vscode.ImplementationProvider {
	public provideImplementation(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Definition> {
		// To keep `guru implements` fast we want to restrict the scope of the search to current workpsace
		// If no workpsace is open, then no-op
		const root = getWorkspaceFolderPath(document.uri);
		if (!root) {
			vscode.window.showInformationMessage('Cannot find implementations when there is no workspace open.');
			return;
		}

		return new Promise<vscode.Definition>((resolve, reject) => {
			if (token.isCancellationRequested) {
				return resolve(null);
			}
			let env = getToolsEnvVars();
			let listProcess = cp.execFile(getGoRuntimePath(), ['list', '-e', '-json'], { cwd: root, env }, (err, stdout, stderr) => {
				if (err) {
					return reject(err);
				}
				let listOutput = <GoListOutput>JSON.parse(stdout.toString());
				let filename = canonicalizeGOPATHPrefix(document.fileName);
				let cwd = path.dirname(filename);
				let offset = byteOffsetAt(document, position);
				let goGuru = getBinPath('guru');
				const buildTags = vscode.workspace.getConfiguration('go', document.uri)['buildTags'];
				let args = buildTags ? ['-tags', buildTags] : [];
				if (listOutput.Root && listOutput.ImportPath) {
					args.push('-scope', `${listOutput.ImportPath}/...`);
				}
				args.push('-json', 'implements', `${filename}:#${offset.toString()}`);

				let guruProcess = cp.execFile(goGuru, args, { env }, (err, stdout, stderr) => {
					if (err && (<any>err).code === 'ENOENT') {
						promptForMissingTool('guru');
						return resolve(null);
					}

					if (err) {
						return reject(err);
					}

					let guruOutput = <GuruImplementsOutput>JSON.parse(stdout.toString());
					let results: vscode.Location[] = [];
					let addResults = list => {
						list.forEach(ref => {
							let match = /^(.*):(\d+):(\d+)/.exec(ref.pos);
							if (!match) return;
							let [_, file, lineStartStr, colStartStr] = match;
							let referenceResource = vscode.Uri.file(path.resolve(cwd, file));
							let range = new vscode.Range(
								+lineStartStr - 1, +colStartStr - 1, +lineStartStr - 1, +colStartStr
							);
							results.push(new vscode.Location(referenceResource, range));
						});
					};

					// If we looked for implementation of method go to method implementations only
					if (guruOutput.to_method) {
						addResults(guruOutput.to_method);
					} else if (guruOutput.to) {
						addResults(guruOutput.to);
					} else if (guruOutput.from) {
						addResults(guruOutput.from);
					} else if (guruOutput.fromptr) {
						addResults(guruOutput.fromptr);
					}

					return resolve(results);
				});
				token.onCancellationRequested(() => guruProcess.kill());
			});
			token.onCancellationRequested(() => listProcess.kill());
		});
	}
}
