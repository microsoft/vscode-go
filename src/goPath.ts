/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import fs = require('fs');
import path = require('path');
import os = require('os');
import cp = require('child_process');
import { showGoStatus, hideGoStatus } from './goStatus'

var binPathCache : { [bin: string]: string;} = {}

export function getBinPath(binname) {
	binname = correctBinname(binname);
	if(binPathCache[binname]) return binPathCache[binname];

	// First search each GOPATH workspace's bin folder
	var workspaces = getPathParts(process.env["GOPATH"]);
	for(var i = 0; i < workspaces.length; i++) {
		let binpath = path.join(workspaces[i], "bin", binname);
		if(fs.existsSync(binpath)) {
			binPathCache[binname] = binpath;
			return binpath;
		}
	}

	// Then search PATH parts
	var pathparts = getPathParts(process.env["PATH"]);
	for(var i = 0; i < pathparts.length; i++) {
		let binpath = path.join(pathparts[i], binname);
		if(fs.existsSync(binpath)) {
			binPathCache[binname] = binpath;
			return binpath;
		}
	}

	// Finally check GOROOT just in case
	{
		let binpath = path.join(process.env["GOROOT"], "bin", binname);
		if(fs.existsSync(binpath)) {
			binPathCache[binname] = binpath;
			return binpath;
		}
	}

	// Else return the binary name directly (this will likely always fail downstream) 
	binPathCache[binname] = binname;
	return binname;
}

function correctBinname(binname) {
	if (process.platform === 'win32')
		return binname + ".exe";
	else
		return binname
}

function getPathParts(path: string) {
	var seperator : string;
	switch(os.platform()) {
		case 'win32':
		case 'win64':
			seperator = ';'; 
			break;
		case 'linux':
		case 'darwin':
		default:
			seperator = ':';
	}
	
	var parts = path.split(seperator);
	return parts;
}

export function setupGoPathAndOfferToInstallTools() {
	// TODO: There should be a better way to do this?
	var gopath = vscode.workspace.getConfiguration('go')['gopath'];
		
	// Make sure GOPATH is set
	if(gopath) {
		process.env["GOPATH"] = gopath;
	}
	
	if (!process.env["GOPATH"]) {
		var info =  "GOPATH is not set as an environment variable or via `go.gopath` setting in Code";
		showGoStatus("GOPATH not set", "go.gopathinfo", info);
		vscode.commands.registerCommand("go.gopathinfo", () => {
			vscode.window.showInformationMessage(info);
			hideGoStatus()
		});
		return;
	}

	// Offer to install any missing tools
	var tools: {[key:string]: string} = {
		gorename: "golang.org/x/tools/cmd/gorename",
		gocode: "github.com/nsf/gocode",
		goreturns: "sourcegraph.com/sqs/goreturns",
		godef: "github.com/rogpeppe/godef",
		golint: "github.com/golang/lint/golint",
		"go-find-references": "github.com/lukehoban/go-find-references",
		"go-outline": "github.com/lukehoban/go-outline"
	}
	var keys = Object.keys(tools)
	Promise.all(keys.map(tool => new Promise<string>((resolve, reject) => {
		let toolPath = getBinPath(tool);
		fs.exists(toolPath, exists => {
			resolve(exists ? null : tools[tool])
		});
	}))).then(res => {
		var missing = res.filter(x => x != null);
		if(missing.length > 0) {
			showGoStatus("Analysis Tools Missing", "go.promptforinstall", "Not all Go tools are available on the GOPATH");
			vscode.commands.registerCommand("go.promptforinstall", () => {
				promptForInstall(missing);
				hideGoStatus();
			});
		}
	});

	function promptForInstall(missing: string[]) {
		
		var item = {
            title: "Install",
            command() {
				var channel = vscode.window.createOutputChannel('Go');
				channel.show();
                missing.forEach(tool => {
                    var p = cp.exec("go get -u -v " + tool, { cwd: process.env['GOPATH'], env: process.env });
                    p.stderr.on('data', (data: string) => {
                        channel.append(data);
                    });
                });
            }
        };
		vscode.window.showInformationMessage("Some Go analysis tools are missing from your GOPATH.  Would you like to install them?", item).then(selection => {
            if (selection) {
                selection.command();
            }
        });
	}
}