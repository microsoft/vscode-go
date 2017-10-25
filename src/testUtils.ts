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
export function getTestFunctions(doc: vscode.TextDocument, checker: prefixChecker): Thenable<vscode.SymbolInformation[]> {
	let documentSymbolProvider = new GoDocumentSymbolProvider();
	return documentSymbolProvider
		.provideDocumentSymbols(doc, null)
		.then(symbols =>
			symbols.filter(sym =>
				sym.kind === vscode.SymbolKind.Function
				&& checker(sym.name))
		);
}

/**
 * Function type for function that given a function name has 
 * returns whether it is of a certain type of prefix.
 * 
 * @param the function name.
 * @return whether the name has a function prefix.
 */
type prefixChecker = (name: string) => boolean;

/**
 * Returns whether a given function name has a test prefix.
 * Test functions have "Test" or "Example" as a prefix.
 *
 * @param the function name.
 * @return whether the name has a test function prefix.
 */
export function hasTestFunctionPrefix(name: string): boolean {
	return name.startsWith('Test') || name.startsWith('Example');
}

/**
 * Returns whether a given function name has a benchmark prefix.
 * Benchmark functions have "Benchmark" as a prefix.
 *
 * @param the function name.
 * @return whether the name has a benchmark function prefix.
 */
export function hasBenchmarkFunctionPrefix(name: string): boolean {
	return name.startsWith('Benchmark');
}

/**
 * Runs go test and presents the output in the 'Go' channel.
 *
 * @param goConfig Configuration for the Go extension.
 */
export function goTest(testconfig: TestConfig): Thenable<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		outputChannel.clear();
		if (!testconfig.background) {

			outputChannel.show(true);
		}

		let buildTags: string = testconfig.goConfig['buildTags'];

		let args: Array<string>;
		let handleFunc: argsHandleFunc;
		let testType: string;

		if (testconfig.isBenchmark) {
			args = ['test', ...testconfig.flags, '-benchmem', '-run=^$'];
			handleFunc = benchmarkTargetArgs;
			testType = "Benchmarks";
		} else {
			args = ['test', ...testconfig.flags, '-timeout', testconfig.goConfig['testTimeout']];
			handleFunc = testTargetArgs;
			testType = "Tests";
		}
		if (buildTags && testconfig.flags.indexOf('-tags') === -1) {
			args.push('-tags');
			args.push(buildTags);
		}
		let testEnvVars = getTestEnvVars(testconfig.goConfig);
		let goRuntimePath = getGoRuntimePath();

		if (!goRuntimePath) {
			vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
			return Promise.resolve();
		}

		// Append the package name to args to enable running tests in symlinked directories
		let currentGoWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), testconfig.dir);
		if (currentGoWorkspace && !testconfig.includeSubDirectories) {
			args.push(testconfig.dir.substr(currentGoWorkspace.length + 1));
		}

		handleFunc(testconfig).then(targets => {
			let outTargets = args.slice(0);
			if (targets.length > 2) {
				outTargets.push('<long arguments omitted>');
			} else {
				outTargets.push(...targets);
			}
			outputChannel.appendLine(['Running tool:', goRuntimePath, ...outTargets].join(' '));
			outputChannel.appendLine('');

			args.push(...targets);

			let proc = cp.spawn(goRuntimePath, args, { env: testEnvVars, cwd: testconfig.dir });
			const outBuf = new LineBuffer();
			const errBuf = new LineBuffer();

			outBuf.onLine(line => outputChannel.appendLine(expandFilePathInOutput(line, testconfig.dir)));
			outBuf.onDone(last => last && outputChannel.appendLine(expandFilePathInOutput(last, testconfig.dir)));

			errBuf.onLine(line => outputChannel.appendLine(line));
			errBuf.onDone(last => last && outputChannel.appendLine(last));
		
			proc.stdout.on('data', chunk => outBuf.append(chunk.toString()));
			proc.stderr.on('data', chunk => errBuf.append(chunk.toString()));
			
			proc.on('close', code => {
				outBuf.done();
				errBuf.done();

				if (code) {
					outputChannel.appendLine(`Error: ${testType} failed.`);
				} else {
					outputChannel.appendLine(`Success: ${testType} passed.`);
				}
				resolve(code === 0);
			});
		}, err => {
			outputChannel.appendLine(`Error: ${testType} failed.`);
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

function expandFilePathInOutput(output: string, cwd: string): string {
	let lines = output.split('\n');
	for (let i = 0; i < lines.length; i++) {
		let matches = lines[i].match(/^\s+(\S+_test.go):(\d+):/);
		if (matches) {
			lines[i] = lines[i].replace(matches[1], path.join(cwd, matches[1]));
		}
	}
	return lines.join('\n');
}

/**
 * Function type for getting the target arguments.
 *
 * @param testconfig Configuration for the Go extension.
 */
type argsHandleFunc = (testconfig: TestConfig) => Thenable<Array<string>>;

/**
 * Get the test target arguments.
 *
 * @param testconfig Configuration for the Go extension.
 */
function testTargetArgs(testconfig: TestConfig): Thenable<Array<string>> {
	if (testconfig.functions) {
		return Promise.resolve(['-run', util.format('^%s$', testconfig.functions.join('|'))]);
	} else if (testconfig.includeSubDirectories) {
		return getGoVersion().then((ver: SemVersion) => {
			if (ver && (ver.major > 1 || (ver.major === 1 && ver.minor >= 9))) {
				return ['./...'];
			}
			return getNonVendorPackages(testconfig.dir);
		});
	}
	return Promise.resolve([]);
}

/**
 * Get the benchmark target arguments.
 *
 * @param testconfig Configuration for the Go extension.
 */
function benchmarkTargetArgs(testconfig: TestConfig): Thenable<Array<string>> {
	return Promise.resolve(['-bench', util.format('^%s$', testconfig.functions.join('|'))]);
}
