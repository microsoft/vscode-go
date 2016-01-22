
import { TextDocument, Position } from 'vscode';
import { getBinPath } from './goPath'
import { basename, dirname } from 'path';
import { spawn, ChildProcess } from 'child_process';
import vscode = require('vscode');
import fs = require('fs');

export function byteOffsetAt(document: TextDocument, position: Position): number {
	let offset = document.offsetAt(position);
	let text = document.getText();
	let byteOffset = 0;
	for (let i = 0; i < offset; i++) {
		let clen = Buffer.byteLength(text[i]);
		byteOffset += clen;
	}
	return byteOffset;
}

export interface Prelude {
	imports: Array<{kind: string; start: number; end: number;}>;
	pkg: {start: number; end: number;};
}

export function parseFilePrelude(text: string): Prelude {
	let lines = text.split('\n');
	let ret: Prelude = {imports: [], pkg: null };
	for (var i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (line.match(/^(\s)*package(\s)+/)) {
			ret.pkg = {start: i, end: i};
		}
		if (line.match(/^(\s)*import(\s)+\(/)) {
			ret.imports.push({kind: "multi", start: i, end: -1});
		}
		if (line.match(/^(\s)*import(\s)+[^\(]/)) {
			ret.imports.push({kind: "single", start: i, end: i});
		}
		if (line.match(/^(\s)*\)/)) {
			if(ret.imports[ret.imports.length - 1].end == -1) {
				ret.imports[ret.imports.length - 1].end = i;
			}
		}
		if (line.match(/^(\s)*(func|const|type|var)/)) {
			break;
		}
	}
	return ret;
}

export function buildProject(outFile: string, mainFile:string) {
	
	var goBuild = getBinPath("go");
	var buildArgs = ["build"];
	buildArgs = buildArgs.concat(["-o"]);
	buildArgs = buildArgs.concat([outFile]);
	buildArgs = buildArgs.concat(["-a"]);

	if(!fs.existsSync(mainFile)){
		printResultError("-1");
		return;
	}
	

	var buildEnv = process.env["GOPATH"];
	
	
	this.buildProcess = spawn(goBuild, buildArgs, {
				cwd: mainFile,
				env: buildEnv,
			});
			
	this.buildProcess.stderr.on('data',printResultError);
	
	this.buildProcess.stdout.on('data',printResultInfo);
	
	this.buildProcess.on('exit', printResultInfo);
	
	this.buildProcess.on('error', printResultError);

}

function printResultInfo(data:string){
	console.log("Process exiting with : " + data);
	data = (data == "0"?"Success!":data);
	vscode.window.showInformationMessage("Build Output :["+data+"]");
}

function printResultError(data:string){
	console.error("Process exiting with : " + data);
	vscode.window.showErrorMessage("Build Failed. ["+data+"]");
	vscode.window.showErrorMessage("Please check go.mainfolder in settings.json ");
	
}