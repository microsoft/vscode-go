/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import vscode = require('vscode');
import path = require('path');
import { getGoRuntimePath, getBinPathWithPreferredGopath, resolveHomeDir, getInferredGopath } from './goPath';
import cp = require('child_process');
import TelemetryReporter from 'vscode-extension-telemetry';
import fs = require('fs');
import os = require('os');

const extensionId: string = 'lukehoban.Go';
const extensionVersion: string = vscode.extensions.getExtension(extensionId).packageJSON.version;
const aiKey: string = 'AIF-d9b70cd4-b9f9-4d70-929b-a071c400b217';

export const goKeywords: string[] = [
	'break',
	'case',
	'chan',
	'const',
	'continue',
	'default',
	'defer',
	'else',
	'fallthrough',
	'for',
	'func',
	'go',
	'goto',
	'if',
	'import',
	'interface',
	'map',
	'package',
	'range',
	'return',
	'select',
	'struct',
	'switch',
	'type',
	'var'
];

export interface SemVersion {
	major: number;
	minor: number;
}

let goVersion: SemVersion = null;
let vendorSupport: boolean = null;
let telemtryReporter: TelemetryReporter;
let toolsGopath: string;

export function byteOffsetAt(document: vscode.TextDocument, position: vscode.Position): number {
	let offset = document.offsetAt(position);
	let text = document.getText();
	return Buffer.byteLength(text.substr(0, offset));
}

export interface Prelude {
	imports: Array<{ kind: string; start: number; end: number; }>;
	pkg: { start: number; end: number; name: string };
}

export function parseFilePrelude(text: string): Prelude {
	let lines = text.split('\n');
	let ret: Prelude = { imports: [], pkg: null };
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		let pkgMatch = line.match(/^(\s)*package(\s)+(\w+)/);
		if (pkgMatch) {
			ret.pkg = { start: i, end: i, name: pkgMatch[3] };
		}
		if (line.match(/^(\s)*import(\s)+\(/)) {
			ret.imports.push({ kind: 'multi', start: i, end: -1 });
		}
		if (line.match(/^(\s)*import(\s)+[^\(]/)) {
			ret.imports.push({ kind: 'single', start: i, end: i });
		}
		if (line.match(/^(\s)*\)/)) {
			if (ret.imports[ret.imports.length - 1].end === -1) {
				ret.imports[ret.imports.length - 1].end = i;
			}
		}
		if (line.match(/^(\s)*(func|const|type|var)/)) {
			break;
		}
	}
	return ret;
}

// Takes a Go function signature like:
//     (foo, bar string, baz number) (string, string)
// and returns an array of parameter strings:
//     ["foo", "bar string", "baz string"]
// Takes care of balancing parens so to not get confused by signatures like:
//     (pattern string, handler func(ResponseWriter, *Request)) {
export function parameters(signature: string): string[] {
	let ret: string[] = [];
	let parenCount = 0;
	let lastStart = 1;
	for (let i = 1; i < signature.length; i++) {
		switch (signature[i]) {
			case '(':
				parenCount++;
				break;
			case ')':
				parenCount--;
				if (parenCount < 0) {
					if (i > lastStart) {
						ret.push(signature.substring(lastStart, i));
					}
					return ret;
				}
				break;
			case ',':
				if (parenCount === 0) {
					ret.push(signature.substring(lastStart, i));
					lastStart = i + 2;
				}
				break;
		}
	}
	return null;
}

export function canonicalizeGOPATHPrefix(filename: string): string {
	let gopath: string = getCurrentGoPath();
	if (!gopath) return filename;
	let workspaces = gopath.split(path.delimiter);
	let filenameLowercase = filename.toLowerCase();

	// In case of multiple workspaces, find current workspace by checking if current file is
	// under any of the workspaces in $GOPATH
	let currentWorkspace: string = null;
	for (let workspace of workspaces) {
		// In case of nested workspaces, (example: both /Users/me and /Users/me/a/b/c are in $GOPATH)
		// both parent & child workspace in the nested workspaces pair can make it inside the above if block
		// Therefore, the below check will take longer (more specific to current file) of the two
		if (filenameLowercase.substring(0, workspace.length) === workspace.toLowerCase()
			&& (!currentWorkspace || workspace.length > currentWorkspace.length)) {
			currentWorkspace = workspace;
		}
	}

	if (!currentWorkspace) return filename;
	return currentWorkspace + filename.slice(currentWorkspace.length);
}

/**
 * Gets version of Go based on the output of the command `go version`.
 * Returns null if go is being used from source/tip in which case `go version` will not return release tag like go1.6.3
 */
export function getGoVersion(): Promise<SemVersion> {
	let goRuntimePath = getGoRuntimePath();

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}

	if (goVersion) {
		/* __GDPR__
		   "getGoVersion" : {
			  "version" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
		   }
		 */
		sendTelemetryEvent('getGoVersion', { version: `${goVersion.major}.${goVersion.minor}` });
		return Promise.resolve(goVersion);
	}
	return new Promise<SemVersion>((resolve, reject) => {
		cp.execFile(goRuntimePath, ['version'], {}, (err, stdout, stderr) => {
			let matches = /go version go(\d).(\d).*/.exec(stdout);
			if (matches) {
				goVersion = {
					major: parseInt(matches[1]),
					minor: parseInt(matches[2])
				};
				/* __GDPR__
				   "getGoVersion" : {
					  "version" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				   }
				 */
				sendTelemetryEvent('getGoVersion', { version: `${goVersion.major}.${goVersion.minor}` });
			} else {
				/* __GDPR__
				   "getGoVersion" : {
					  "version" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				   }
				 */
				sendTelemetryEvent('getGoVersion', { version: stdout });
			}
			return resolve(goVersion);
		});
	});
}

/**
 * Returns boolean denoting if current version of Go supports vendoring
 */
export function isVendorSupported(): Promise<boolean> {
	if (vendorSupport != null) {
		return Promise.resolve(vendorSupport);
	}
	return getGoVersion().then(version => {
		if (!version) {
			return process.env['GO15VENDOREXPERIMENT'] === '0' ? false : true;
		}

		switch (version.major) {
			case 0:
				vendorSupport = false;
				break;
			case 1:
				vendorSupport = (version.minor > 6 || ((version.minor === 5 || version.minor === 6) && process.env['GO15VENDOREXPERIMENT'] === '1')) ? true : false;
				break;
			default:
				vendorSupport = true;
				break;
		}
		return vendorSupport;
	});
}

/**
 * Returns boolean indicating if GOPATH is set or not
 * If not set, then prompts user to do set GOPATH
 */
export function isGoPathSet(): boolean {
	if (!getCurrentGoPath()) {
		vscode.window.showInformationMessage('Set GOPATH environment variable and restart VS Code or set GOPATH in Workspace settings', 'Set GOPATH in Workspace Settings').then(selected => {
			if (selected === 'Set GOPATH in Workspace Settings') {
				vscode.commands.executeCommand('workbench.action.openWorkspaceSettings');
			}
		});
		return false;
	}

	return true;
}

export function sendTelemetryEvent(eventName: string, properties?: {
	[key: string]: string;
}, measures?: {
	[key: string]: number;
}): void {

	let temp = vscode.extensions.getExtension(extensionId).packageJSON.contributes;
	telemtryReporter = telemtryReporter ? telemtryReporter : new TelemetryReporter(extensionId, extensionVersion, aiKey);
	telemtryReporter.sendTelemetryEvent(eventName, properties, measures);
}

export function isPositionInString(document: vscode.TextDocument, position: vscode.Position): boolean {
	let lineText = document.lineAt(position.line).text;
	let lineTillCurrentPosition = lineText.substr(0, position.character);

	// Count the number of double quotes in the line till current position. Ignore escaped double quotes
	let doubleQuotesCnt = (lineTillCurrentPosition.match(/\"/g) || []).length;
	let escapedDoubleQuotesCnt = (lineTillCurrentPosition.match(/\\\"/g) || []).length;

	doubleQuotesCnt -= escapedDoubleQuotesCnt;
	return doubleQuotesCnt % 2 === 1;
}

export function getToolsGopath(useCache: boolean = true): string {
	if (!useCache || !toolsGopath) {
		toolsGopath = resolveToolsGopath();
	}

	return toolsGopath;
}

function resolveToolsGopath(): string {

	let toolsGopathForWorkspace = vscode.workspace.getConfiguration('go')['toolsGopath'] || '';

	// In case of single root, use resolvePath to resolve ~ and ${workspaceRoot}
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length <= 1) {
		return resolvePath(toolsGopathForWorkspace);
	}

	// In case of multi-root, resolve ~ and ignore ${workspaceRoot}
	if (toolsGopathForWorkspace.startsWith('~')) {
		toolsGopathForWorkspace = path.join(os.homedir(), toolsGopathForWorkspace.substr(1));
	}
	if (toolsGopathForWorkspace && toolsGopathForWorkspace.trim() && !/\${workspaceRoot}/.test(toolsGopathForWorkspace)) {
		return toolsGopathForWorkspace;
	}

	// If any of the folders in multi root have toolsGopath set, use it.
	for (let i = 0; i < vscode.workspace.workspaceFolders.length; i++) {
		let toolsGopath = <string>vscode.workspace.getConfiguration('go', vscode.workspace.workspaceFolders[i].uri).inspect('toolsGopath').workspaceFolderValue;
		toolsGopath = resolvePath(toolsGopath, vscode.workspace.workspaceFolders[i].uri.fsPath);
		if (toolsGopath) {
			return toolsGopath;
		}
	}
}

export function getBinPath(tool: string): string {
	return getBinPathWithPreferredGopath(tool, getToolsGopath(), getCurrentGoPath());
}

export function getFileArchive(document: vscode.TextDocument): string {
	let fileContents = document.getText();
	return document.fileName + '\n' + Buffer.byteLength(fileContents, 'utf8') + '\n' + fileContents;
}

export function getToolsEnvVars(): any {
	const config = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri : null);
	const toolsEnvVars = config['toolsEnvVars'];

	let gopath = getCurrentGoPath();

	let envVars = Object.assign({}, process.env, gopath ? { GOPATH: gopath } : {});

	if (toolsEnvVars && typeof toolsEnvVars === 'object') {
		Object.keys(toolsEnvVars).forEach(key => envVars[key] = resolvePath(toolsEnvVars[key]));
	}

	return envVars;
}

export function getCurrentGoPath(workspaceUri?: vscode.Uri): string {
	if (!workspaceUri && vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) {
		workspaceUri = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri;
	}
	const config = vscode.workspace.getConfiguration('go', workspaceUri);
	const currentRoot = workspaceUri ? workspaceUri.fsPath : vscode.workspace.rootPath;
	const configGopath = config['gopath'] ? resolvePath(config['gopath'], currentRoot) : '';
	const inferredGopath = config['inferGopath'] === true ? getInferredGopath(currentRoot) : '';

	return inferredGopath ? inferredGopath : (configGopath || process.env['GOPATH']);
}

export function getExtensionCommands(): any[] {
	let pkgJSON = vscode.extensions.getExtension(extensionId).packageJSON;
	if (!pkgJSON.contributes || !pkgJSON.contributes.commands) {
		return;
	}
	let extensionCommands: any[] = vscode.extensions.getExtension(extensionId).packageJSON.contributes.commands.filter(x => x.command !== 'go.show.commands');
	return extensionCommands;
}

export class LineBuffer {
	private buf: string = '';
	private lineListeners: { (line: string): void; }[] = [];
	private lastListeners: { (last: string): void; }[] = [];

	append(chunk: string) {
		this.buf += chunk;
		do {
			const idx = this.buf.indexOf('\n');
			if (idx === -1) {
				break;
			}

			this.fireLine(this.buf.substring(0, idx));
			this.buf = this.buf.substring(idx + 1);
		} while (true);
	}

	done() {
		this.fireDone(this.buf !== '' ? this.buf : null);
	}

	private fireLine(line: string) {
		this.lineListeners.forEach(listener => listener(line));
	}

	private fireDone(last: string) {
		this.lastListeners.forEach(listener => listener(last));
	}

	onLine(listener: (line: string) => void) {
		this.lineListeners.push(listener);
	}

	onDone(listener: (last: string) => void) {
		this.lastListeners.push(listener);
	}
}

export function timeout(millis): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		setTimeout(() => resolve(), millis);
	});
}

/**
 * Exapnds ~ to homedir in non-Windows platform and resolves ${workspaceRoot}
 */
export function resolvePath(inputPath: string, workspaceRoot?: string): string {
	if (!inputPath || !inputPath.trim()) return inputPath;

	if (!workspaceRoot && vscode.workspace.workspaceFolders) {
		if (vscode.workspace.workspaceFolders.length === 1) {
			workspaceRoot = vscode.workspace.rootPath;
		} else if (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) {
			workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri.fsPath;
		}
	}

	if (workspaceRoot) {
		inputPath = inputPath.replace(/\${workspaceRoot}/g, workspaceRoot);
	}
	return resolveHomeDir(inputPath);
}

