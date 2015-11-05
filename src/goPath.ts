import fs = require('fs');
import path = require('path');
import vscode = require('vscode');
import os = require('os');
import cp = require('child_process');

var binPathCache : { [bin: string]: string;} = {}

export function getBinPath(binname) {
	if(binPathCache[binname]) return binPathCache[binname];
	var workspaces = getGOPATHWorkspaces();
	var binpath: string;
	for(var i = 0; i < workspaces.length; i++) {
		binpath = path.join(workspaces[i], "bin", binname);
		if(fs.existsSync(workspaces[i])) {
			return binpath;
		}
	}
	console.log("Couldn't find a binary in any GOPATH workspaces: ", binname, " ", workspaces)
	return path.join(process.env["GOPATH"], "bin", binname);
}

function getGOPATHWorkspaces() {
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
	
	var parts = process.env["GOPATH"].split(seperator);
	return parts;
}

export function setupGoPathAndOfferToInstallTools() {
	// TODO: There should be a better way to do this?
	vscode.extensions.getConfigurationMemento('go').getValue<string>('gopath').then(gopath => {
		
		// Make sure GOPATH is set
		if(!process.env["GOPATH"] && gopath) {
			process.env["GOPATH"] = gopath;
		}
		
		if(!process.env["GOPATH"]) {
			vscode.languages.addWarningLanguageStatus("go", "GOPATH not set", () => {
				vscode.window.showInformationMessage("GOPATH is not set as an environment variable or via `go.gopath` setting in Code");
			});
			return;
		}

		// Offer to install any missing tools
		var tools = {
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
			let toolPath = path.join(process.env["GOPATH"], 'bin', tool);
			if (process.platform === 'win32')
				toolPath = toolPath + ".exe";
			fs.exists(toolPath, exists => {
				resolve(exists ? null : tools[tool])
			});
		}))).then(res => {
			var missing = res.filter(x => x != null);
			if(missing.length > 0) {
				let status = vscode.languages.addWarningLanguageStatus("go", "Analysis Tools Missing", () => {
					promptForInstall(missing, status);
				});
			}
		});

		function promptForInstall(missing: string[], status: vscode.Disposable) {
			
			var channel = vscode.window.getOutputChannel('Go');
			channel.reveal();
			
			vscode.window.showInformationMessage("Some Go analysis tools are missing from your GOPATH.  Would you like to install them?", {
				title: "Install",
				command: () => {
					missing.forEach(tool => {
						var p = cp.exec("go get -u -v " + tool, { cwd: process.env['GOPATH'], env: process.env });
						p.stderr.on('data', (data: string) => {
								channel.append(data);
						});
					});
				}
			});
			status.dispose();
		}
	});
}