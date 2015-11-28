/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import os = require('os');
import fs = require('fs');
import { getBinPath } from './goPath'

//TODO: Less hacky?
var go: string;
if (process.env.GOROOT) {
	go = path.join(process.env["GOROOT"], "bin", "go");
} else if (process.env.PATH) {
	var pathparts = (<string>process.env.PATH).split((<any>path).delimiter);
	go = pathparts.map(dir => path.join(dir, 'go' + (os.platform() == "win32" ? ".exe" : ""))).filter(candidate => fs.existsSync(candidate))[0];
}
if (!go) {
	vscode.window.showInformationMessage("No 'go' binary could be found on PATH or in GOROOT.");
}

export interface ICheckResult {
	file: string;
	line: number;
	msg: string;
	severity: string;
}

export function check(filename: string, buildOnSave = true, lintOnSave = true, vetOnSave = true): Promise<ICheckResult[]> {
	var gobuild = !buildOnSave ? Promise.resolve([]) : new Promise((resolve, reject) => {
		var tmppath = path.normalize(path.join(os.tmpdir(), "go-code-check"))
		var cwd = path.dirname(filename)
		var args = ["build", "-o", tmppath, "."];
		if (filename.match(/_test.go$/i)) {
			args = ['test', '-copybinary', '-o', tmppath, '-c', '.']
		}
		cp.execFile(go, args, { cwd: cwd }, (err, stdout, stderr) => {
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
					var match = /([^:]*):(\d+)(:\d+)?: (.*)/.exec(lines[i]);
					if (!match) continue;
					var [_, file, lineStr, charStr, msg] = match;
					var line = +lineStr;
					ret.push({ file: path.resolve(cwd, file), line, msg, severity: "error" });
				}
				resolve(ret);
			} catch (e) {
				reject(e);
			}
		});
	});

	var golint = !lintOnSave ? Promise.resolve([]) : new Promise((resolve, reject) => {
		var cwd = path.dirname(filename)
		var golint = getBinPath("golint");
		cp.execFile(golint, [filename], { cwd: cwd }, (err, stdout, stderr) => {
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

	var govet = !vetOnSave ? Promise.resolve([]) : new Promise((resolve, reject) => {
		var cwd = path.dirname(filename)
		cp.execFile(go, ["tool", "vet", filename], { cwd: cwd }, (err, stdout, stderr) => {
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