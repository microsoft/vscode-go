/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

/**
 * This file is loaded by both the extension and debug adapter, so it cannot import 'vscode'
 */
import fs = require('fs');
import path = require('path');
import os = require('os');

let binPathCache: { [bin: string]: string; } = {};
let runtimePathCache: string = '';

export function getBinPathFromEnvVar(toolName: string, envVarValue: string, appendBinToPath: boolean): string {
	toolName = correctBinname(toolName);
	if (envVarValue) {
		let paths = envVarValue.split(path.delimiter);
		for (let i = 0; i < paths.length; i++) {
			let binpath = path.join(paths[i], appendBinToPath ? 'bin' : '', toolName);
			if (fileExists(binpath)) {
				binPathCache[toolName] = binpath;
				return binpath;
			}
		}
	}
	return null;
}

export function getBinPathWithPreferredGopath(binname: string, preferredGopath: string = null) {
	if (binPathCache[correctBinname(binname)]) return binPathCache[correctBinname(binname)];

	// Search in the preferred GOPATH workspace's bin folder
	let pathFrompreferredGoPath = getBinPathFromEnvVar(binname, preferredGopath, true);
	if (pathFrompreferredGoPath) {
		return pathFrompreferredGoPath;
	}

	// Then search user's GOPATH workspace's bin folder
	let pathFromGoPath = getBinPathFromEnvVar(binname, process.env['GOPATH'], true);
	if (pathFromGoPath) {
		return pathFromGoPath;
	}

	// Then search PATH parts
	let pathFromPath = getBinPathFromEnvVar(binname, process.env['PATH'], false);
	if (pathFromPath) {
		return pathFromPath;
	}

	// Finally check GOROOT just in case
	let pathFromGoRoot = getBinPathFromEnvVar(binname, process.env['GOROOT'], true);
	if (pathFromGoRoot) {
		return pathFromGoRoot;
	}

	// Else return the binary name directly (this will likely always fail downstream)
	return binname;
}

function correctBinname(binname: string) {
	if (process.platform === 'win32')
		return binname + '.exe';
	else
		return binname;
}

/**
 * Returns Go runtime binary path.
 *
 * @return the path to the Go binary.
 */
export function getGoRuntimePath(): string {
	if (runtimePathCache) return runtimePathCache;
	let correctBinNameGo = correctBinname('go');
	if (process.env['GOROOT']) {
		runtimePathCache = path.join(process.env['GOROOT'], 'bin', correctBinNameGo);
	} else if (process.env['PATH']) {
		let pathparts = (<string>process.env.PATH).split(path.delimiter);
		runtimePathCache = pathparts.map(dir => path.join(dir, correctBinNameGo)).filter(candidate => fileExists(candidate))[0];
	}
	return runtimePathCache;
}

function fileExists(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch (e) {
		return false;
	}
}

export function clearCacheForTools() {
	binPathCache = {};
}

/**
 * Exapnds ~ to homedir in non-Windows platform and replaces ${workspaceRoot} token with given workspaceroot
 */
export function resolvePath(inputPath: string, workspaceRoot?: string): string {
	if (!inputPath || !inputPath.trim()) return inputPath;
	if (workspaceRoot) {
		inputPath = inputPath.replace(/\${workspaceRoot}/g, workspaceRoot);
	}
	return inputPath.startsWith('~') ? path.join(os.homedir(), inputPath.substr(1)) : inputPath;
}