/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import { SemVersion, isAbove, getConfig, isBelow } from './util';
import { goLiveErrorsEnabled } from './goLiveErrors';

export interface Tool {
	name: string;
	importPath: string;
	isImportant: boolean;
	description: string;
}

// getImportPath returns the import path for a given tool, at a given Go version.
export function getImportPath(tool: Tool, goVersion: SemVersion): string {
	// For older versions of Go, install the older version of gocode.
	// TODO: We should either not support this or install nsf/gocode as "gocode-old" or something.
	if (tool.name === 'gocode' && isBelow(goVersion, 1, 10)) {
		return 'github.com/nsf/gocode';
	}
	return tool.importPath;
}

export function isWildcard(tool: Tool, goVersion: SemVersion): boolean {
	const importPath = getImportPath(tool, goVersion);
	return importPath.endsWith('...');
}

export function containsTool(tools: Tool[], tool: Tool): boolean {
	return tools.indexOf(tool) > -1;
}

export function containsString(tools: Tool[], toolName: string): boolean {
	return tools.some(tool => tool.name === toolName);
}

export function getTool(name: string): Tool {
	return allToolsInformation[name];
}

// hasModSuffix returns true if the given tool has a different, module-specific
// name to avoid conflicts.
export function hasModSuffix(tool: Tool): boolean {
	return tool.name.endsWith('-gomod');
}

export function isGocode(tool: Tool): boolean {
	return tool.name === 'gocode' || tool.name === 'gocode-gomod';
}

export function getConfiguredTools(goVersion: SemVersion): Tool[] {
	// Start with default tools that are always installed.
	const tools: string[] = [
		'gocode',
		'gopkgs',
		'go-outline',
		'go-symbols',
		'guru',
		'gorename',
		'gotests',
		'gomodifytags',
		'impl',
		'fillstruct',
		'goplay',
		'godoctor',
	];

	// Check if the system supports dlv, i.e. is 64-bit.
	// There doesn't seem to be a good way to check if the mips and s390
	// families are 64-bit, so just try to install it and hope for the best.
	if (process.arch.match(/^(arm64|mips|mipsel|ppc64|s390|s390x|x64)$/)) {
		tools.push('dlv');
	}

	// gocode-gomod needed in go 1.11 & higher
	if (!goVersion || (goVersion.major === 1 && goVersion.minor >= 11)) {
		tools.push('gocode-gomod');
	}

	const goConfig = getConfig('go');

	// Install the doc/def tool that was chosen by the user.
	switch (goConfig['docsTool']) {
		case 'godoc':
			tools.push('godef');
			break;
		default:
			tools.push(goConfig['docsTool']);
			break;
	}

	// Install the format tool that was chosen by the user.
	tools.push(goConfig['formatTool']);

	// Install the linter that was chosen by the user.
	tools.push(goConfig['lintTool']);

	// Install the language server for Go versions >= 1.11.
	if (goConfig['useLanguageServer'] && isAbove(goVersion, 1, 10)) {
		tools.push('gopls');
	}

	if (goLiveErrorsEnabled()) {
		tools.push('gotype-live');
	}

	// TODO: We need to propagate errors here.
	return tools.map(function(value: string): Tool {
		const tool = allToolsInformation[value];
		if (!tool) {
			console.log(`no tool for ${value}`);
		}
		return tool;
	});
}

const allToolsInformation: { [key: string]: Tool } = {
	'gocode': {
		name: 'gocode',
		importPath: 'github.com/mdempsky/gocode',
		isImportant: true,
		description: 'Auto-completion',
	},
	'gocode-gomod': {
		name: 'gocode-gomod',
		importPath: 'github.com/stamblerre/gocode',
		isImportant: true,
		description: 'Autocompletion, works with modules',
	},
	'gopkgs': {
		name: 'gopkgs',
		importPath: 'github.com/uudashr/gopkgs/cmd/gopkgs',
		isImportant: true,
		description: 'Auto-completion of unimported packages & Add Import feature',
	},
	'go-outline': {
		name: 'go-outline',
		importPath: 'github.com/ramya-rao-a/go-outline',
		isImportant: true,
		description: 'Go to symbol in file',
	},
	'go-symbols': {
		name: 'go-symbols',
		importPath: 'github.com/acroca/go-symbols',
		isImportant: true,
		description: 'Go to symbol in workspace',
	},
	'guru': {
		name: 'guru',
		importPath: 'golang.org/x/tools/cmd/guru',
		isImportant: true,
		description: 'Find all references and Go to implementation of symbols',
	},
	'gorename': {
		name: 'gorename',
		importPath: 'golang.org/x/tools/cmd/gorename',
		isImportant: true,
		description: 'Rename symbols',
	},
	'gomodifytags': {
		name: 'gomodifytags',
		importPath: 'github.com/fatih/gomodifytags',
		isImportant: false,
		description: 'Modify tags on structs',
	},
	'goplay': {
		name: 'goplay',
		importPath: 'github.com/haya14busa/goplay/cmd/goplay',
		isImportant: false,
		description: 'The Go playground',
	},
	'impl': {
		name: 'impl',
		importPath: 'github.com/josharian/impl',
		isImportant: false,
		description: 'Stubs for interfaces',
	},
	'gotype-live': {
		name: 'gotype-live',
		importPath: 'github.com/tylerb/gotype-live',
		isImportant: false,
		description: 'Show errors as you type',
	},
	'godef': {
		name: 'godef',
		importPath: 'github.com/rogpeppe/godef',
		isImportant: true,
		description: 'Go to definition',
	},
	'gogetdoc': {
		name: 'gogetdoc',
		importPath: 'github.com/zmb3/gogetdoc',
		isImportant: true,
		description: 'Go to definition & text shown on hover',
	},
	'goimports': {
		name: 'goimports',
		importPath: 'golang.org/x/tools/cmd/goimports',
		isImportant: true,
		description: 'Formatter',
	},
	'goreturns': {
		name: 'goreturns',
		importPath: 'github.com/sqs/goreturns',
		isImportant: true,
		description: 'Formatter',
	},
	'goformat': {
		name: 'goformat',
		importPath: 'winterdrache.de/goformat/goformat',
		isImportant: false,
		description: 'Formatter',
	},
	'golint': {
		name: 'golint',
		importPath: 'golang.org/x/lint/golint',
		isImportant: true,
		description: 'Linter',
	},
	'gotests': {
		name: 'gotests',
		importPath: 'github.com/cweill/gotests/...',
		isImportant: false,
		description: 'Generate unit tests',
	},
	'staticcheck': {
		name: 'staticcheck',
		importPath: 'honnef.co/go/tools/...',
		isImportant: true,
		description: 'Linter',
	},
	'golangci-lint': {
		name: 'golangci-lint',
		importPath: 'github.com/golangci/golangci-lint/cmd/golangci-lint',
		isImportant: true,
		description: 'Linter',
	},
	'revive': {
		name: 'revive',
		importPath: 'github.com/mgechev/revive',
		isImportant: true,
		description: 'Linter',
	},
	'go-langserver': {
		name: 'go-langserver',
		importPath: 'github.com/sourcegraph/go-langserver',
		isImportant: false,
		description: 'Language Server from Sourcegraph',
	},
	'gopls': {
		name: 'gopls',
		importPath: 'golang.org/x/tools/cmd/gopls',
		isImportant: false,
		description: 'Language Server from Google',
	},
	'dlv': {
		name: 'dlv',
		importPath: 'github.com/go-delve/delve/cmd/dlv',
		isImportant: true,
		description: 'Debugging',
	},
	'fillstruct': {
		name: 'fillstruct',
		importPath: 'github.com/davidrjenni/reftools/cmd/fillstruct',
		isImportant: false,
		description: 'Fill structs with defaults',
	},
	'godoctor': {
		name: 'godoctor',
		importPath: 'github.com/godoctor/godoctor',
		isImportant: false,
		description: 'Extract to functions and variables',
	},
};
