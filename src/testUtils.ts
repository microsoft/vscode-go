/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import cp = require('child_process');
import path = require('path');
import vscode = require('vscode');
import util = require('util');
import { parseEnvFile, getGoRuntimePath, getCurrentGoWorkspaceFromGOPATH } from './goPath';
import { getToolsEnvVars, getGoVersion, LineBuffer, SemVersion, resolvePath, getCurrentGoPath } from './util';
import { GoDocumentSymbolProvider } from './goOutline';
import { getNonVendorPackages } from './goPackages';

let outputChannel = vscode.window.createOutputChannel('Go Tests');
let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
statusBarItem.command = 'go.test.cancel';
statusBarItem.text = 'Cancel Running Tests';

/**
 *  testProcesses holds a list of currently running test processes.
 */
let testProcesses = [];


/**
 * Input to goTest.
 */
export interface TestConfig {
	/**
	 * The working directory for `go test`.
	 */
	dir: string;
	/**
	 * Configuration for the Go extension
	 */
	goConfig: vscode.WorkspaceConfiguration;
	/**
	 * Test flags to override the testFlags and buildFlags from goConfig.
	 */
	flags: string[];
	/**
	 * Specific function names to test.
	 */
	functions?: string[];
	/**
	 * Test was not requested explicitly. The output should not appear in the UI.
	 */
	background?: boolean;
	/**
	 * Run all tests from all sub directories under `dir`
	 */
	includeSubDirectories?: boolean;
	/**
	 * Whether this is a benchmark.
	 */
	isBenchmark?: boolean;
}

export function getTestEnvVars(config: vscode.WorkspaceConfiguration): any {
	const envVars = getToolsEnvVars();
	const testEnvConfig = config['testEnvVars'] || {};

	let fileEnv = {};
	let testEnvFile = config['testEnvFile'];
	if (testEnvFile) {
		testEnvFile = resolvePath(testEnvFile);
		try {
			fileEnv = parseEnvFile(testEnvFile);
		} catch (e) {
			console.log(e);
		}
	}

	Object.keys(testEnvConfig).forEach(key => envVars[key] = resolvePath(testEnvConfig[key]));
	Object.keys(fileEnv).forEach(key => envVars[key] = resolvePath(fileEnv[key]));

	return envVars;
}

export function getTestFlags(goConfig: vscode.WorkspaceConfiguration, args: any): string[] {
	let testFlags: string[] = goConfig['testFlags'] ? goConfig['testFlags'] : goConfig['buildFlags'];
	testFlags = [...testFlags]; // Use copy of the flags, dont pass the actual object from config
	return (args && args.hasOwnProperty('flags') && Array.isArray(args['flags'])) ? args['flags'] : testFlags;
}

/**
 * Returns all Go unit test functions in the given source file.
 *
 * @param the URI of a Go source file.
 * @return test function symbols for the source file.
 */
export function getTestFunctions(doc: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
	let documentSymbolProvider = new GoDocumentSymbolProvider();
	return documentSymbolProvider
		.provideDocumentSymbols(doc, token)
		.then(symbols =>
			symbols.filter(sym =>
				sym.kind === vscode.SymbolKind.Function
				&& (sym.name.startsWith('Test') || sym.name.startsWith('Example')))
		);
}

/**
 * Returns all Benchmark functions in the given source file.
 *
 * @param the URI of a Go source file.
 * @return benchmark function symbols for the source file.
 */
export function getBenchmarkFunctions(doc: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
	let documentSymbolProvider = new GoDocumentSymbolProvider();
	return documentSymbolProvider
		.provideDocumentSymbols(doc, token)
		.then(symbols =>
			symbols.filter(sym =>
				sym.kind === vscode.SymbolKind.Function
				&& sym.name.startsWith('Benchmark'))
		);
}

/**
 * Runs go test and presents the output in the 'Go' channel.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function goTest(testconfig: TestConfig): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {

		// We only want to clear the outputChannel if there are no tests in flight.
		// We do not want to clear it if tests are already running, as that could
		// lose valuable output.
		if (testProcesses.length < 1) {
			outputChannel.clear();
		}

		if (!testconfig.background) {
			let buildTags: string = testconfig.goConfig['buildTags'];
			let args: Array<string> = ['test', ...testconfig.flags];
			let testType: string = testconfig.isBenchmark ? 'Benchmarks' : 'Tests';

			if (testconfig.isBenchmark) {
				args.push('-benchmem', '-run=^$');
			} else {
				args.push('-timeout', testconfig.goConfig['testTimeout']);
			}
			if (buildTags && testconfig.flags.indexOf('-tags') === -1) {
				args.push('-tags', buildTags);
			}

			let testEnvVars = getTestEnvVars(testconfig.goConfig);
			let goRuntimePath = getGoRuntimePath();
			outputChannel.show(true);
		}

		let buildTags: string = testconfig.goConfig['buildTags'];
		let args = ['test', ...testconfig.flags, '-timeout', testconfig.goConfig['testTimeout']];
		if (buildTags && testconfig.flags.indexOf('-tags') === -1) {
			args.push('-tags');
			args.push(buildTags);
		}
		let testEnvVars = getTestEnvVars(testconfig.goConfig);
		let goRuntimePath = getGoRuntimePath();

		// Append the package name to args to enable running tests in symlinked directories
		let currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), testconfig.dir);
		if (currentGoWorkspace && !testconfig.includeSubDirectories) {
			args.push(testconfig.dir.substr(currentGoWorkspace.length + 1));
		}

		targetArgs(testconfig).then(targets => {
			let outTargets = args.slice(0);
			if (targets.length > 2) {
				outTargets.push('<long arguments omitted>');
			} else {
				outTargets.push(...targets);
			}
			outputChannel.appendLine(['Running tool:', goRuntimePath, ...outTargets].join(' '));
			outputChannel.appendLine('');

			args.push(...targets);

			let tp = cp.spawn(goRuntimePath, args, { env: testEnvVars, cwd: testconfig.dir, detached: true });
			const outBuf = new LineBuffer();
			const errBuf = new LineBuffer();

			outBuf.onLine(line => outputChannel.appendLine(expandFilePathInOutput(line, testconfig.dir)));
			outBuf.onDone(last => last && outputChannel.appendLine(expandFilePathInOutput(last, testconfig.dir)));

			errBuf.onLine(line => outputChannel.appendLine(line));
			errBuf.onDone(last => last && outputChannel.appendLine(last));

			tp.stdout.on('data', chunk => outBuf.append(chunk.toString()));
			tp.stderr.on('data', chunk => errBuf.append(chunk.toString()));

			statusBarItem.show();

			tp.on('close', (code, signal) => {
				outBuf.done();
				errBuf.done();

				statusBarItem.hide();

				if (code) {
					outputChannel.appendLine('Error: Tests failed.');
				} else if (signal === 'SIGKILL') {
					outputChannel.appendLine('Tests killed.');
				} else {
					outputChannel.appendLine('Success: Tests passed.');
				}

				// We need to remove this particular test process from the array of test
				// processes so that a subsequent cancel does not attempt to kill a
				// process that no longer exists. This is only an issue if we have
				// multiple test processes running in parallel.
				//
				// If this test process was killed by calling cancelRunningTests, the
				// array will be empty and this entry will not be found or removed.
				let index = testProcesses.indexOf(tp, 0);
				if (index > -1) {
					testProcesses.splice(index, 1);
				}

				resolve(code === 0);
			});

			testProcesses.push(tp);

		}, err => {
			outputChannel.appendLine('Error: Tests failed.');
			outputChannel.appendLine(err);
			resolve(false);
		});
	});
}

/**
 * Reveals the output channel in the UI.
 */
export function showTestOutput() {
	outputChannel.show(true);
}

/**
 * Iterates the list of currently running test processes and kills them all.
 */
export function cancelRunningTests(): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		let tp: cp.ChildProcess;
		testProcesses.forEach(function(tp){
			process.kill(-tp.pid, 'SIGKILL');
		});
		// All processes are now dead. Empty the array to prepare for the next run.
		testProcesses.splice(0, testProcesses.length);
		resolve(true);
	});
}

function expandFilePathInOutput(output: string, cwd: string): string {
	let lines = output.split('\n');
	for (let i = 0; i < lines.length; i++) {
		let matches = lines[i].match(/^\s*(.+.go):(\d+):/);
		if (matches && matches[1] && !path.isAbsolute(matches[1])) {
			lines[i] = lines[i].replace(matches[1], path.join(cwd, matches[1]));
		}
	}
	return lines.join('\n');
}

/**
 * Get the test target arguments.
 *
 * @param testconfig Configuration for the Go extension.
 */
function targetArgs(testconfig: TestConfig): Thenable<Array<string>> {
	if (testconfig.functions) {
		return Promise.resolve([testconfig.isBenchmark ? '-bench' : '-run', util.format('^%s$', testconfig.functions.join('|'))]);
	} else if (testconfig.includeSubDirectories && !testconfig.isBenchmark) {
		return getGoVersion().then((ver: SemVersion) => {
			if (ver && (ver.major > 1 || (ver.major === 1 && ver.minor >= 9))) {
				return ['./...'];
			}
			return getNonVendorPackages(testconfig.dir);
		});
	}
	return Promise.resolve([]);
}

