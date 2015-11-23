/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import fs = require('fs');
import path = require('path');

var binPathCache: { [bin: string]: string; } = {}

export function getBinPath(binname: string) {
	binname = correctBinname(binname);
	if (binPathCache[binname]) return binPathCache[binname];

	// First search each GOPATH workspace's bin folder
	var workspaces = process.env["GOPATH"].split(path.delimiter);
	for (var i = 0; i < workspaces.length; i++) {
		let binpath = path.join(workspaces[i], "bin", binname);
		if (fs.existsSync(binpath)) {
			binPathCache[binname] = binpath;
			return binpath;
		}
	}

	// Then search PATH parts
	var pathparts = process.env["PATH"].split(path.delimiter);
	for (var i = 0; i < pathparts.length; i++) {
		let binpath = path.join(pathparts[i], binname);
		if (fs.existsSync(binpath)) {
			binPathCache[binname] = binpath;
			return binpath;
		}
	}

	// Finally check GOROOT just in case
	{
		let binpath = path.join(process.env["GOROOT"], "bin", binname);
		if (fs.existsSync(binpath)) {
			binPathCache[binname] = binpath;
			return binpath;
		}
	}

	// Else return the binary name directly (this will likely always fail downstream) 
	binPathCache[binname] = binname;
	return binname;
}

function correctBinname(binname: string) {
	if (process.platform === 'win32')
		return binname + ".exe";
	else
		return binname
}
