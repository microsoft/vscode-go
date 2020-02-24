/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import os = require('os');
import cp = require('child_process');
import vscode = require('vscode');
import util = require('util');
import { envPath } from './goPath';
import { getBinPath, getCurrentGoPath, getImportPath, getGoConfig, getGoVersion } from './util';
import { getLanguageServerToolPath } from './goLanguageServer';
import { extensionId } from './telemetry';
import * as path from 'path';

export async function reportIssue() {
	const extension = vscode.extensions.getExtension(extensionId);
	const extensionVersion: string = extension ? extension.packageJSON.version : '';
	const goVer = await getGoVersion();
	const goEnv = await getGoEnv();
	const languageServerInfo = await getLanguageServerInfo();
	const goConfig = getConfigInfo();
	const issuesUrl: string = newIssueURL(extension);

	const envDetails = `
Environment Information
=====
Visual Studio Code
-----
| Name | Version |
| --- | --- |
| Operating System | ${os.type()} ${os.arch()} ${os.release()} |
| VSCode | ${vscode.version.toString()}|
| Go Extension Version | ${extensionVersion.toString()} |
| Go Version | ${goVer.format()} |

LanguageServer
-----
${languageServerInfo}
	
Go Environment
-----
<details><pre>${goEnv}</pre></details>
	
Extension Configuration:
-----
<pre>
${goConfig}
</pre>
`;

	vscode.window.showInformationMessage('Do you want to file an issue?', 'File a bug', 'Let me review first').then((selected) => {
		switch (selected) {
			case 'File a bug':
				openIssue(issuesUrl, envDetails);
				break;
			case 'Let me review first':
				openDraft(issuesUrl, envDetails);
				break;
		}
	})
}

function openIssue(issuesUrl: string, details: string) {
	const body = `
Please review the [Wiki](https://github.com/microsoft/vscode-go/wiki) before filing an issue.

Helpful pages include:
	- [GOPATH](https://github.com/Microsoft/vscode-go/wiki/GOPATH-in-the-VS-Code-Go-extension)
	- [Module Support](https://github.com/microsoft/vscode-go/wiki/Go-modules-support-in-Visual-Studio-Code)
	- [Debugging](https://github.com/Microsoft/vscode-go/wiki/Debugging-Go-code-using-VS-Code)
		- Set "trace": "log" and share the resulting logs in the debug console when logging an issue.
	- [Language Server](https://github.com/golang/tools/blob/master/gopls/README.md#issues)
		- Enable more debugging info following the [instruction](https://github.com/golang/tools/blob/master/gopls/doc/vscode.md#vscode)
	
Describe the bug
=====
A clear and concise description of what the bug is.
A clear and concise description of what you expected to happen.

Screenshots or recordings
=====
If applicable, add screenshots or recordings to help explain your problem.

${details}
`;
	const encodedBody = encodeURIComponent(body);
	const queryStringPrefix: string = "?";
	const fullUrl = `${issuesUrl}${queryStringPrefix}body=${encodedBody}`;
	vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(fullUrl));
}

function openDraft(issuesUrl: string, details: string) {
	const reviewbody = `Please copy and paste the following when filing an issue at ${issuesUrl}
	
	`

	const uri = vscode.Uri.parse('untitled:/vscode-go-bug.md');
	vscode.workspace.openTextDocument(uri).then((doc: vscode.TextDocument) => {
		vscode.window.showTextDocument(doc, 1, false).then(e => {
			e.edit(edit => {
				edit.insert(new vscode.Position(0, 0), reviewbody + details);
			});
		});
	}, (error: any) => {
		console.error(error);
	});
}

async function getGoEnv(): Promise<string> {
	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		return `no go was found in either GOROOT(${process.env['GOROOT']}) or PATH(${envPath})`;
	}

	const env = Object.assign({}, process.env, { GOPATH: getCurrentGoPath() });
	const execFile = util.promisify(cp.execFile);
	const { stdout } = await execFile(goRuntimePath, ['env'], { env });
	return stdout;
}

function newIssueURL(extension: vscode.Extension<any>): string {
	const bugUrl = extension ? extension.packageJSON.bugs.url : '';
	if (bugUrl) {
		return bugUrl + '/new';
	}
	var repoUrl = extension ? extension.packageJSON.repository.url : '';
	// If the url has a .git suffix, remove it
	if (repoUrl.endsWith('.git')) {
		repoUrl = repoUrl.substr(0, repoUrl.length - 4);
	}
	return repoUrl + 'issues/new';
}

async function getLanguageServerInfo(): Promise<string> {
	const languageServerToolPath = getLanguageServerToolPath();
	if (!languageServerToolPath) {
		return "no language server is used";
	}

	const execFile = util.promisify(cp.execFile);
	const { stdout, stderr } = await execFile(languageServerToolPath, ['version']);
	if (stderr) {
		return `failed to find the version of ${languageServerToolPath}`;
	}
	return languageServerToolPath + '\n<details><pre>' + stdout + '</pre></details>';
}

function getConfigInfo(): string {
	const goCfg = getNonDefaultConfig('go');
	const goplsCfg = getNonDefaultConfig('gopls');
	const langGoCfg = getNonDefaultConfig('[go]');
	return goCfg + goplsCfg + langGoCfg;
}

function getNonDefaultConfig(section: string): string {
	const cfg = vscode.workspace.getConfiguration(section);
	var entries: { [key: string]: any } = {};

	Object.getOwnPropertyNames(cfg).forEach((k) => {
		const v = cfg.inspect(k);
		if (!v) { return; }
		if (v.workspaceValue) { entries[v.key] = v.workspaceValue; return; }
		if (v.globalValue) { entries[v.key] = v.globalValue; return; }
		// skip if the value is from the default value or undefined.
	});
	const ret = JSON.stringify(entries, undefined, '\t');
	return ret.substring(1, ret.length - 1);
}