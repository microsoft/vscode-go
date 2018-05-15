/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import vscode = require('vscode');
import path = require('path');
import { getGoRuntimePath, getBinPathWithPreferredGopath, resolveHomeDir, getInferredGopath, fixDriveCasingInWindows } from './goPath';
import cp = require('child_process');
import TelemetryReporter from 'vscode-extension-telemetry';
import fs = require('fs');
import os = require('os');
import { outputChannel } from './goStatus';
import { errorDiagnosticCollection, warningDiagnosticCollection } from './goMain';

const extensionId: string = 'ms-vscode.Go';
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

export const goBuiltinTypes: Set<string> = new Set<string>([
	'bool',
	'byte',
	'complex128',
	'complex64',
	'error',
	'float32',
	'float64',
	'int',
	'int16',
	'int32',
	'int64',
	'int8',
	'rune',
	'string',
	'uint',
	'uint16',
	'uint32',
	'uint64',
	'uint8',
	'uintptr'
]);

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
		if (line.match(/^(\s)*(\/\*.*\*\/)*\s*\)/)) {
			if (ret.imports[ret.imports.length - 1].end === -1) {
				ret.imports[ret.imports.length - 1].end = i;
			}
		}
		if (line.match(/^(\s)*(func|const|type|var)\s/)) {
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
export function getParametersAndReturnType(signature: string): { params: string[], returnType: string } {
	let params: string[] = [];
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
						params.push(signature.substring(lastStart, i));
					}
					return {
						params,
						returnType: i < signature.length - 1 ? signature.substr(i + 1) : ''
					};
				}
				break;
			case ',':
				if (parenCount === 0) {
					params.push(signature.substring(lastStart, i));
					lastStart = i + 2;
				}
				break;
		}
	}
	return { params: [], returnType: '' };
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
			let matches = /go version go(\d).(\d+).*/.exec(stdout);
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

	telemtryReporter = telemtryReporter ? telemtryReporter : new TelemetryReporter(extensionId, extensionVersion, aiKey);
	telemtryReporter.sendTelemetryEvent(eventName, properties, measures);
}

export function disposeTelemetryReporter(): Promise<any> {
	if (telemtryReporter) {
		return telemtryReporter.dispose();
	}
	return Promise.resolve(null);
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

	const gopath = getCurrentGoPath();
	const envVars = Object.assign({}, process.env, gopath ? { GOPATH: gopath } : {});

	if (toolsEnvVars && typeof toolsEnvVars === 'object') {
		Object.keys(toolsEnvVars).forEach(key => envVars[key] = typeof toolsEnvVars[key] === 'string' ? resolvePath(toolsEnvVars[key]) : toolsEnvVars[key]);
	}

	// cgo expects go to be in the path
	const goroot: string = envVars['GOROOT'];
	let pathEnvVar: string;
	if (envVars.hasOwnProperty('PATH')) {
		pathEnvVar = 'PATH';
	} else if (process.platform === 'win32' && envVars.hasOwnProperty('Path')) {
		pathEnvVar = 'Path';
	}
	if (goroot && pathEnvVar && envVars[pathEnvVar] && (<string>envVars[pathEnvVar]).split(path.delimiter).indexOf(goroot) === -1) {
		envVars[pathEnvVar] += path.delimiter + path.join(goroot, 'bin');
	}

	return envVars;
}

export function getCurrentGoPath(workspaceUri?: vscode.Uri): string {
	let currentFilePath: string;
	if (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) {
		workspaceUri = workspaceUri || vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri).uri;
		currentFilePath = vscode.window.activeTextEditor.document.uri.fsPath;
	}
	const config = vscode.workspace.getConfiguration('go', workspaceUri);
	let currentRoot = workspaceUri ? workspaceUri.fsPath : vscode.workspace.rootPath;

	// Workaround for issue in https://github.com/Microsoft/vscode/issues/9448#issuecomment-244804026
	if (process.platform === 'win32') {
		currentRoot = fixDriveCasingInWindows(currentRoot) || '';
		currentFilePath = fixDriveCasingInWindows(currentFilePath) || '';
	}

	// Infer the GOPATH from the current root or the path of the file opened in current editor
	// Last resort: Check for the common case where GOPATH itself is opened directly in VS Code
	let inferredGopath: string;
	if (config['inferGopath'] === true) {
		inferredGopath = getInferredGopath(currentRoot) || getInferredGopath(currentFilePath);
		if (!inferredGopath) {
			try {
				if (fs.statSync(path.join(currentRoot, 'src')).isDirectory()) {
					inferredGopath = currentRoot;
				}
			}
			catch (e) {
				// No op
			}
		}
	}

	const configGopath = config['gopath'] ? resolvePath(config['gopath'], currentRoot) : '';
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
		inputPath = inputPath.replace(/\${workspaceRoot}/g, workspaceRoot).replace(/\${workspaceFolder}/g, workspaceRoot);
	}
	return resolveHomeDir(inputPath);
}

/**
 * Returns the import path in a passed in string.
 * @param text The string to search for an import path
 */
export function getImportPath(text: string): string {
	// Catch cases like `import alias "importpath"` and `import "importpath"`
	let singleLineImportMatches = text.match(/^\s*import\s+([a-z,A-Z,_,\.]\w*\s+)?\"([^\"]+)\"/);
	if (singleLineImportMatches) {
		return singleLineImportMatches[2];
	}

	// Catch cases like `alias "importpath"` and "importpath"
	let groupImportMatches = text.match(/^\s*([a-z,A-Z,_,\.]\w*\s+)?\"([^\"]+)\"/);
	if (groupImportMatches) {
		return groupImportMatches[2];
	}

	return '';
}

// TODO: Add unit tests for the below

/**
 * Guess the package name based on parent directory name of the given file
 *
 * Cases:
 * - dir 'go-i18n' -> 'i18n'
 * - dir 'go-spew' -> 'spew'
 * - dir 'kingpin' -> 'kingpin'
 * - dir 'go-expand-tilde' -> 'tilde'
 * - dir 'gax-go' -> 'gax'
 * - dir 'go-difflib' -> 'difflib'
 * - dir 'jwt-go' -> 'jwt'
 * - dir 'go-radix' -> 'radix'
 *
 * @param {string} filePath.
 */
export function guessPackageNameFromFile(filePath): Promise<string[]> {
	return new Promise((resolve, reject) => {

		const goFilename = path.basename(filePath);
		if (goFilename === 'main.go') {
			return resolve(['main']);
		}

		const directoryPath = path.dirname(filePath);
		const dirName = path.basename(directoryPath);
		let segments = dirName.split(/[\.-]/);
		segments = segments.filter(val => val !== 'go');

		if (segments.length === 0 || !/[a-zA-Z_]\w*/.test(segments[segments.length - 1])) {
			return reject();
		}

		const proposedPkgName = segments[segments.length - 1];

		fs.stat(path.join(directoryPath, 'main.go'), (err, stats) => {
			if (stats && stats.isFile()) {
				return resolve(['main']);
			}

			if (goFilename.endsWith('_test.go')) {
				return resolve([proposedPkgName, proposedPkgName + '_test']);
			}

			return resolve([proposedPkgName]);
		});
	});
}

export interface ICheckResult {
	file: string;
	line: number;
	col: number;
	msg: string;
	severity: string;
}

/**
 * Runs given Go tool and returns errors/warnings that can be fed to the Problems Matcher
 * @param args Arguments to be passed while running given tool
 * @param cwd cwd that will passed in the env object while running given tool
 * @param severity error or warning
 * @param useStdErr If true, the stderr of the output of the given tool will be used, else stdout will be used
 * @param toolName The name of the Go tool to run. If none is provided, the go runtime itself is used
 * @param printUnexpectedOutput If true, then output that doesnt match expected format is printed to the output channel
 */
export function runTool(args: string[], cwd: string, severity: string, useStdErr: boolean, toolName: string, env: any, printUnexpectedOutput: boolean, token?: vscode.CancellationToken): Promise<ICheckResult[]> {
	let goRuntimePath = getGoRuntimePath();
	let cmd;
	if (toolName) {
		cmd = getBinPath(toolName);
	} else {
		if (!goRuntimePath) {
			return Promise.reject(new Error('Cannot find "go" binary. Update PATH or GOROOT appropriately'));
		}
		cmd = goRuntimePath;
	}

	let p: cp.ChildProcess;
	if (token) {
		token.onCancellationRequested(() => {
			if (p) {
				killTree(p.pid);
			}
		});
	}
	cwd = fixDriveCasingInWindows(cwd);
	return new Promise((resolve, reject) => {
		p = cp.execFile(cmd, args, { env: env, cwd: cwd }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code === 'ENOENT') {
					// Since the tool is run on save which can be frequent
					// we avoid sending explicit notification if tool is missing
					console.log(`Cannot find ${toolName ? toolName : goRuntimePath}`);
					return resolve([]);
				}
				if (err && stderr && !useStdErr) {
					outputChannel.appendLine(['Error while running tool:', cmd, ...args].join(' '));
					outputChannel.appendLine(stderr);
					return resolve([]);
				}
				let lines = (useStdErr ? stderr : stdout).toString().split('\n');
				outputChannel.appendLine([cwd + '>Finished running tool:', cmd, ...args].join(' '));

				let ret: ICheckResult[] = [];
				let unexpectedOutput = false;
				let atleastSingleMatch = false;
				for (let i = 0; i < lines.length; i++) {
					if (lines[i][0] === '\t' && ret.length > 0) {
						ret[ret.length - 1].msg += '\n' + lines[i];
						continue;
					}
					let match = /^([^:]*: )?((.:)?[^:]*):(\d+)(:(\d+)?)?:(?:\w+:)? (.*)$/.exec(lines[i]);
					if (!match) {
						if (printUnexpectedOutput && useStdErr && stderr) unexpectedOutput = true;
						continue;
					}
					atleastSingleMatch = true;
					let [_, __, file, ___, lineStr, ____, colStr, msg] = match;
					let line = +lineStr;
					let col = +colStr;

					// Building skips vendor folders,
					// But vet and lint take in directories and not import paths, so no way to skip them
					// So prune out the results from vendor folders herehere.
					if (!path.isAbsolute(file) && (file.startsWith(`vendor${path.sep}`) || file.indexOf(`${path.sep}vendor${path.sep}`) > -1)) {
						continue;
					}

					file = path.resolve(cwd, file);
					ret.push({ file, line, col, msg, severity });
					outputChannel.appendLine(`${file}:${line}: ${msg}`);
				}
				if (!atleastSingleMatch && unexpectedOutput && vscode.window.activeTextEditor) {
					outputChannel.appendLine(stderr);
					if (err) {
						ret.push({
							file: vscode.window.activeTextEditor.document.fileName,
							line: 1,
							col: 1,
							msg: stderr,
							severity: 'error'
						});
					}
				}
				outputChannel.appendLine('');
				resolve(ret);
			} catch (e) {
				reject(e);
			}
		});
	});
}

export function handleDiagnosticErrors(document: vscode.TextDocument, errors: ICheckResult[], diagnosticSeverity?: vscode.DiagnosticSeverity) {

	if (diagnosticSeverity === undefined || diagnosticSeverity === vscode.DiagnosticSeverity.Error) {
		errorDiagnosticCollection.clear();
	}
	if (diagnosticSeverity === undefined || diagnosticSeverity === vscode.DiagnosticSeverity.Warning) {
		warningDiagnosticCollection.clear();
	}

	let diagnosticMap: Map<string, Map<vscode.DiagnosticSeverity, vscode.Diagnostic[]>> = new Map();
	errors.forEach(error => {
		let canonicalFile = vscode.Uri.file(error.file).toString();
		let startColumn = 0;
		let endColumn = 1;
		if (document && document.uri.toString() === canonicalFile) {
			let range = new vscode.Range(error.line - 1, 0, error.line - 1, document.lineAt(error.line - 1).range.end.character + 1);
			let text = document.getText(range);
			let [_, leading, trailing] = /^(\s*).*(\s*)$/.exec(text);
			if (!error.col) {
				startColumn = leading.length;
			} else {
				startColumn = error.col - 1; // range is 0-indexed
			}
			endColumn = text.length - trailing.length;
		}
		let range = new vscode.Range(error.line - 1, startColumn, error.line - 1, endColumn);
		let severity = mapSeverityToVSCodeSeverity(error.severity);
		let diagnostic = new vscode.Diagnostic(range, error.msg, severity);
		let diagnostics = diagnosticMap.get(canonicalFile);
		if (!diagnostics) {
			diagnostics = new Map<vscode.DiagnosticSeverity, vscode.Diagnostic[]>();
		}
		if (!diagnostics[severity]) {
			diagnostics[severity] = [];
		}
		diagnostics[severity].push(diagnostic);
		diagnosticMap.set(canonicalFile, diagnostics);
	});

	diagnosticMap.forEach((diagMap, file) => {
		const fileUri = vscode.Uri.parse(file);
		if (diagnosticSeverity === undefined || diagnosticSeverity === vscode.DiagnosticSeverity.Error) {
			const newErrors = diagMap[vscode.DiagnosticSeverity.Error];
			let existingWarnings = warningDiagnosticCollection.get(fileUri);
			errorDiagnosticCollection.set(fileUri, newErrors);

			// If there are warnings on current file, remove the ones co-inciding with the new errors
			if (newErrors && existingWarnings) {
				const errorLines = newErrors.map(x => x.range.start.line);
				existingWarnings = existingWarnings.filter(x => errorLines.indexOf(x.range.start.line) === -1);
				warningDiagnosticCollection.set(fileUri, existingWarnings);
			}
		}
		if (diagnosticSeverity === undefined || diagnosticSeverity === vscode.DiagnosticSeverity.Warning) {
			const existingErrors = errorDiagnosticCollection.get(fileUri);
			let newWarnings = diagMap[vscode.DiagnosticSeverity.Warning];

			// If there are errors on current file, ignore the new warnings co-inciding with them
			if (existingErrors && newWarnings) {
				const errorLines = existingErrors.map(x => x.range.start.line);
				newWarnings = newWarnings.filter(x => errorLines.indexOf(x.range.start.line) === -1);
			}

			warningDiagnosticCollection.set(fileUri, newWarnings);
		}
	});
};


function mapSeverityToVSCodeSeverity(sev: string): vscode.DiagnosticSeverity {
	switch (sev) {
		case 'error': return vscode.DiagnosticSeverity.Error;
		case 'warning': return vscode.DiagnosticSeverity.Warning;
		default: return vscode.DiagnosticSeverity.Error;
	}
}

export function getWorkspaceFolderPath(fileUri: vscode.Uri): string {
	if (fileUri) {
		let workspace = vscode.workspace.getWorkspaceFolder(fileUri);
		if (workspace) {
			return workspace.uri.fsPath;
		}
	}

	// fall back to the first workspace
	let folders = vscode.workspace.workspaceFolders;
	if (folders && folders.length) {
		return folders[0].uri.fsPath;
	}
}

export function killProcess(p: cp.ChildProcess) {
	if (p) {
		try {
			p.kill();
		} catch (e) {
			console.log('Error killing process: ' + e);
			if (e && e.message && e.stack) {
				let matches = e.stack.match(/(src.go[a-z,A-Z]+\.js)/g);
				if (matches) {
					/* __GDPR__
					   "errorKillingProcess" : {
						  "message" : { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" },
						  "stack": { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" }
					   }
					 */
					sendTelemetryEvent('errorKillingProcess', { message: e.message, stack: matches });
				}
			}

		}
	}
}

export function killTree(processId: number): void {
	if (process.platform === 'win32') {
		const TASK_KILL = 'C:\\Windows\\System32\\taskkill.exe';

		// when killing a process in Windows its child processes are *not* killed but become root processes.
		// Therefore we use TASKKILL.EXE
		try {
			cp.execSync(`${TASK_KILL} /F /T /PID ${processId}`);
		} catch (err) {
		}
	} else {
		// on linux and OS X we kill all direct and indirect child processes as well
		try {
			const cmd = path.join(__dirname, '../../../scripts/terminateProcess.sh');
			cp.spawnSync(cmd, [processId.toString()]);
		} catch (err) {
		}
	}
}
