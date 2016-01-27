/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import os = require('os');
import fs = require('fs');
import { getBinPath, getGoRuntimePath } from './goPath'

if (!getGoRuntimePath()) {
	vscode.window.showInformationMessage("No 'go' binary could be found on PATH or in GOROOT.");
}

export interface ICheckResult {
	file: string;
	line: number;
	msg: string;
	severity: string;
}

export function check(filename: string, goConfig: vscode.WorkspaceConfiguration): Promise<ICheckResult[]> {
	var gobuild = !goConfig['buildOnSave'] ? Promise.resolve([]) : new Promise((resolve, reject) => {
		var buildFlags = goConfig['buildFlags'] || [];
		var tmppath = path.normalize(path.join(os.tmpdir(), "go-code-check"));
		var cwd = path.dirname(filename);
		var args = ["build", "-o", tmppath, ...buildFlags, "."];
		if (filename.match(/_test.go$/i)) {
			args = ['test', '-copybinary', '-o', tmppath, '-c', '.'];
		}
		cp.execFile(getGoRuntimePath(), args, { cwd: cwd }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code == "ENOENT") {
					vscode.window.showInformationMessage("The 'go' compiler is not available.  Install Go from http://golang.org/dl/.");
					return resolve([]);
				}
				var lines = stderr.toString().split('\n');
				var ret: ICheckResult[] = [];
				for (var i = 0; i < lines.length; i++) {
					if(lines[i][0] == '\t' && ret.length > 0) {
						ret[ret.length-1].msg += "\n" + lines[i];
						continue;
					}
					var match = /^([^:]*: )?([^:]*):(\d+)(:\d+)?: (.*)$/.exec(lines[i]);
					if (!match) continue;
					var [_, _, file, lineStr, charStr, msg] = match;
					var line = +lineStr;
					ret.push({ file: path.resolve(cwd, file), line, msg, severity: "error" });
				}
				resolve(ret);
			} catch (e) {
				reject(e);
			}
		});
	});

	var golint = !goConfig['lintOnSave'] ? Promise.resolve([]) : new Promise((resolve, reject) => {
		var cwd = path.dirname(filename);
		var golint = getBinPath("golint");
		var lintFlags = goConfig['lintFlags'] || [];
		cp.execFile(golint, [...lintFlags, filename], { cwd: cwd }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code == "ENOENT") {
					vscode.window.showInformationMessage("The 'golint' command is not available.  Use 'go get -u github.com/golang/lint/golint' to install.");
					return resolve([]);
				}
				var lines = stdout.toString().split('\n');
				var ret: ICheckResult[] = [];
				for (var i = 0; i < lines.length; i++) {
					var match = /(.*):(\d+):(\d+): (.*)/.exec(lines[i]);
					if (!match) continue;
					var [_, file, lineStr, colStr, msg] = match;
					var line = +lineStr;
					ret.push({ file: path.resolve(cwd, file), line, msg, severity: "warning" });
				}
				resolve(ret);
			} catch (e) {
				reject(e);
			}
		});
	});

	var govet = !goConfig['vetOnSave'] ? Promise.resolve([]) : new Promise((resolve, reject) => {
		var cwd = path.dirname(filename);
		var vetFlags = goConfig['vetFlags'] || [];
		cp.execFile(getGoRuntimePath(), ["tool", "vet", ...vetFlags, filename], { cwd: cwd }, (err, stdout, stderr) => {
			try {
				if (err && (<any>err).code == "ENOENT") {
					vscode.window.showInformationMessage("The 'go tool vet' compiler is not available.  Install Go from http://golang.org/dl/.");
					return resolve([]);
				}
				var lines = stderr.toString().split('\n');
				var ret: ICheckResult[] = [];
				for (var i = 0; i < lines.length; i++) {
					var match = /(.*):(\d+): (.*)/.exec(lines[i]);
					if (!match) continue;
					var [_, file, lineStr, msg] = match;
					var line = +lineStr;
					ret.push({ file: path.resolve(cwd, file), line, msg, severity: "warning" });
				}
				resolve(ret);
			} catch (e) {
				reject(e);
			}
		});
	});

	return Promise.all([gobuild, golint, govet]).then(resultSets => [].concat.apply([], resultSets));
}