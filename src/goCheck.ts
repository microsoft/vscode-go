/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import monaco = require('monaco');
import cp = require('child_process');
import path = require('path');
import os = require('os');

export interface ICheckResult {
	file: string;
	line: number;
	msg: string;
	severity: string;
}

export function check(filename: string): Promise<ICheckResult[]> {
	var gobuild = new Promise((resolve, reject) => {
		var tmppath = path.normalize(path.join(os.tmpdir(), "go-code-check"))
		var cwd = path.dirname(filename)
		var args = ["build", "-o", tmppath, "."];
		if(filename.match(/_test.go$/i)) {
			args = ['test', '-copybinary', '-o', tmppath, '-c', '.']
		}
		var process = cp.execFile("go", args, {cwd: cwd}, (err, stdout, stderr) => {
			try {
				var lines = stderr.toString().split('\n');
				var ret: ICheckResult[] = [];
				for(var i = 1; i < lines.length; i++) {
					var match = /(.*):(\d+): (.*)/.exec(lines[i]);
					if(!match) continue;
					var [_, file, lineStr, msg] = match;
					var line = +lineStr;
					ret.push({ file: path.resolve(cwd, file), line, msg, severity: "error" });
				}
				resolve(ret);
			} catch(e) {
				reject(e);
			}
		});
	});

	var golint = new Promise((resolve, reject) => {
		var cwd = path.dirname(filename)
		var process = cp.execFile("golint", [filename], {cwd: cwd}, (err, stdout, stderr) => {
			try {
				var lines = stdout.toString().split('\n');
				var ret: ICheckResult[] = [];
				for(var i = 0; i < lines.length; i++) {
					var match = /(.*):(\d+):(\d+): (.*)/.exec(lines[i]);
					if(!match) continue;
					var [_, file, lineStr, colStr, msg] = match;
					var line = +lineStr;
					ret.push({ file: path.resolve(cwd, file), line, msg, severity: "warning" });
				}
				resolve(ret);
			} catch(e) {
				reject(e);
			}
		});
	});

	var govet = new Promise((resolve, reject) => {
		var cwd = path.dirname(filename)
		var process = cp.execFile("go", ["tool", "vet", filename], {cwd: cwd}, (err, stdout, stderr) => {
			try {
				var lines = stdout.toString().split('\n');
				var ret: ICheckResult[] = [];
				for(var i = 0; i < lines.length; i++) {
					var match = /(.*):(\d+): (.*)/.exec(lines[i]);
					if(!match) continue;
					var [_, file, lineStr, msg] = match;
					var line = +lineStr;
					ret.push({ file: path.resolve(cwd, file), line, msg, severity: "warning" });
				}
				resolve(ret);
			} catch(e) {
				reject(e);
			}
		});
	});

	return Promise.all([gobuild, golint, govet]).then(resultSets => [].concat.apply([], resultSets));
}