/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import cp = require('child_process');
import moment = require('moment');
import path = require('path');
import semver = require('semver');
import util = require('util');
import vscode = require('vscode');
import {
	FormattingOptions,
	HandleDiagnosticsSignature,
	LanguageClient,
	ProvideDocumentFormattingEditsSignature,
	ProvideDocumentLinksSignature,
	RevealOutputChannelOn
} from 'vscode-languageclient';
import WebRequest = require('web-request');
import { GoDefinitionProvider } from './goDeclaration';
import { GoHoverProvider } from './goExtraInfo';
import { GoDocumentFormattingEditProvider } from './goFormat';
import { GoImplementationProvider } from './goImplementations';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';
import { parseLiveFile } from './goLiveErrors';
import { GO_MODE } from './goMode';
import { GoDocumentSymbolProvider } from './goOutline';
import { getToolFromToolPath } from './goPath';
import { GoReferenceProvider } from './goReferences';
import { GoRenameProvider } from './goRename';
import { GoSignatureHelpProvider } from './goSignature';
import { GoCompletionItemProvider } from './goSuggest';
import { GoWorkspaceSymbolProvider } from './goSymbol';
import { getTool, Tool } from './goTools';
import { GoTypeDefinitionProvider } from './goTypeDefinition';
import { getBinPath, getCurrentGoPath, getGoConfig, getToolsEnvVars, isForNightly } from './util';

interface LanguageServerConfig {
	enabled: boolean;
	flags: string[];
	features: {
		diagnostics: boolean;
		format: boolean;
		documentLink: boolean;
	};
	checkForUpdates: boolean;
}

// registerLanguageFeatures registers providers for all the language features.
// It looks to either the language server or the standard providers for these features.
export async function registerLanguageFeatures(ctx: vscode.ExtensionContext) {
	// Subscribe to notifications for changes to the configuration of the language server.
	ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => watchLanguageServerConfiguration(e)));

	const config = parseLanguageServerConfig();

	// If the user has not enabled the language server,
	// register the default language features and return.
	if (!config.enabled) {
		registerUsualProviders(ctx);
		return;
	}

	// The user has opted into the language server.
	const languageServerToolPath = getLanguageServerToolPath();
	const toolName = getToolFromToolPath(languageServerToolPath);
	if (!toolName) {
		// language server binary is not installed yet.
		// Return immediately. The information messages such as
		// offering to install missing tools, and suggesting to
		// reload the window after installing the language server
		// should be presented by now.
		return;
	}
	const env = getToolsEnvVars();

	// If installed, check. The user may not have the most up-to-date version of the language server.
	const tool = getTool(toolName);
	const update = await shouldUpdateLanguageServer(tool, languageServerToolPath, config.checkForUpdates);
	if (update) {
		promptForUpdatingTool(toolName);
	}

	const c = new LanguageClient(
		toolName,
		{
			command: languageServerToolPath,
			args: ['-mode=stdio', ...config.flags],
			options: { env }
		},
		{
			initializationOptions: {},
			documentSelector: ['go', 'go.mod', 'go.sum'],
			uriConverters: {
				// Apply file:/// scheme to all file paths.
				code2Protocol: (uri: vscode.Uri): string =>
					(uri.scheme ? uri : uri.with({ scheme: 'file' })).toString(),
				protocol2Code: (uri: string) => vscode.Uri.parse(uri)
			},
			revealOutputChannelOn: RevealOutputChannelOn.Never,
			middleware: {
				provideDocumentFormattingEdits: (
					document: vscode.TextDocument,
					options: FormattingOptions,
					token: vscode.CancellationToken,
					next: ProvideDocumentFormattingEditsSignature
				) => {
					if (!config.features.format) {
						return [];
					}
					return next(document, options, token);
				},
				handleDiagnostics: (
					uri: vscode.Uri,
					diagnostics: vscode.Diagnostic[],
					next: HandleDiagnosticsSignature
				) => {
					if (!config.features.diagnostics) {
						return null;
					}
					return next(uri, diagnostics);
				},
				provideDocumentLinks: (
					document: vscode.TextDocument,
					token: vscode.CancellationToken,
					next: ProvideDocumentLinksSignature
				) => {
					if (!config.features.documentLink) {
						return null;
					}
					return next(document, token);
				}
			}
		}
	);

	c.onReady().then(() => {
		const capabilities = c.initializeResult && c.initializeResult.capabilities;
		if (!capabilities) {
			return vscode.window.showErrorMessage(
				'The language server is not able to serve any features at the moment.'
			);
		}

		// Fallback to default providers for unsupported or disabled features.

		if (!capabilities.completionProvider) {
			const provider = new GoCompletionItemProvider(ctx.globalState);
			ctx.subscriptions.push(provider);
			ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider(GO_MODE, provider, '.', '"'));
		}
		if (!config.features.format || !capabilities.documentFormattingProvider) {
			ctx.subscriptions.push(
				vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider())
			);
		}

		if (!capabilities.renameProvider) {
			ctx.subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));
		}

		if (!capabilities.typeDefinitionProvider) {
			ctx.subscriptions.push(
				vscode.languages.registerTypeDefinitionProvider(GO_MODE, new GoTypeDefinitionProvider())
			);
		}

		if (!capabilities.hoverProvider) {
			ctx.subscriptions.push(vscode.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
		}

		if (!capabilities.definitionProvider) {
			ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
		}

		if (!capabilities.referencesProvider) {
			ctx.subscriptions.push(vscode.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
		}

		if (!capabilities.documentSymbolProvider) {
			ctx.subscriptions.push(
				vscode.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSymbolProvider())
			);
		}

		if (!capabilities.signatureHelpProvider) {
			ctx.subscriptions.push(
				vscode.languages.registerSignatureHelpProvider(GO_MODE, new GoSignatureHelpProvider(), '(', ',')
			);
		}

		if (!capabilities.workspaceSymbolProvider) {
			ctx.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new GoWorkspaceSymbolProvider()));
		}

		if (!capabilities.implementationProvider) {
			ctx.subscriptions.push(
				vscode.languages.registerImplementationProvider(GO_MODE, new GoImplementationProvider())
			);
		}
	});

	let languageServerDisposable = c.start();
	ctx.subscriptions.push(languageServerDisposable);

	ctx.subscriptions.push(
		vscode.commands.registerCommand('go.languageserver.restart', async () => {
			if (c.diagnostics) {
				c.diagnostics.clear();
			}
			await c.stop();
			languageServerDisposable.dispose();
			languageServerDisposable = c.start();
			ctx.subscriptions.push(languageServerDisposable);
		})
	);

	// gopls is the only language server that provides live diagnostics on type,
	// so use gotype if it's not enabled.
	if (!(toolName === 'gopls' && config.features['diagnostics'])) {
		vscode.workspace.onDidChangeTextDocument(parseLiveFile, null, ctx.subscriptions);
	}
}

function watchLanguageServerConfiguration(e: vscode.ConfigurationChangeEvent) {
	if (!e.affectsConfiguration('go')) {
		return;
	}

	const config = parseLanguageServerConfig();
	let reloadMessage: string;

	// If the user has disabled or enabled the language server.
	if (e.affectsConfiguration('go.useLanguageServer')) {
		if (config.enabled) {
			reloadMessage = 'Reload VS Code window to enable the use of language server';
		} else {
			reloadMessage = 'Reload VS Code window to disable the use of language server';
		}
	}

	if (
		e.affectsConfiguration('go.languageServerFlags') ||
		e.affectsConfiguration('go.languageServerExperimentalFeatures')
	) {
		reloadMessage = 'Reload VS Code window for the changes in language server settings to take effect';
	}

	// If there was a change in the configuration of the language server,
	// then ask the user to reload VS Code.
	if (reloadMessage) {
		vscode.window.showInformationMessage(reloadMessage, 'Reload').then((selected) => {
			if (selected === 'Reload') {
				vscode.commands.executeCommand('workbench.action.reloadWindow');
			}
		});
	}
}

export function parseLanguageServerConfig(): LanguageServerConfig {
	const goConfig = getGoConfig();

	const config = {
		enabled: goConfig['useLanguageServer'],
		flags: goConfig['languageServerFlags'] || [],
		features: {
			// TODO: We should have configs that match these names.
			// Ultimately, we should have a centralized language server config rather than separate fields.
			diagnostics: goConfig['languageServerExperimentalFeatures']['diagnostics'],
			format: goConfig['languageServerExperimentalFeatures']['format'],
			documentLink: goConfig['languageServerExperimentalFeatures']['documentLink'],
			highlight: goConfig['languageServerExperimentalFeatures']['highlight']
		},
		checkForUpdates: goConfig['useGoProxyToCheckForToolUpdates']
	};
	return config;
}

/**
 * If the user has enabled the language server, return the absolute path to the
 * correct binary. If the required tool is not available, prompt the user to
 * install it. Only gopls is officially supported.
 */
export function getLanguageServerToolPath(): string {
	const goConfig = getGoConfig();
	if (!goConfig['useLanguageServer']) {
		return;
	}

	// Check that all workspace folders are configured with the same GOPATH.
	if (!allFoldersHaveSameGopath()) {
		vscode.window.showInformationMessage(
			'The Go language server is currently not supported in a multi-root set-up with different GOPATHs.'
		);
		return;
	}

	// Determine which language server the user has selected.
	// gopls is the default choice.
	let languageServerOfChoice = 'gopls';
	if (goConfig['alternateTools']) {
		const goplsAlternate = goConfig['alternateTools']['gopls'];

		// Check if the user has set the deprecated "go-langserver" setting.
		if (goConfig['alternateTools']['go-langserver']) {
			vscode.window.showErrorMessage(`The "go.alternateTools" setting for "go-langserver" has been deprecated.
Please set "gopls" instead, and then reload the VS Code window.`);
			return;
		}
		if (goplsAlternate) {
			if (typeof goplsAlternate !== 'string') {
				vscode.window.showErrorMessage(`Unexpected type for "go.alternateTools" setting for "gopls": ${typeof goplsAlternate}.`);
				return;
			}
			languageServerOfChoice = getToolFromToolPath(goplsAlternate);
		}
	}
	// Get the path to the language server binary.
	const languageServerBinPath = getBinPath(languageServerOfChoice);
	if (path.isAbsolute(languageServerBinPath)) {
		return languageServerBinPath;
	}

	// Installation of gopls is supported. Other language servers must be installed manually.
	if (languageServerOfChoice !== 'gopls') {
		vscode.window.showErrorMessage(
			`Cannot find the language server ${languageServerOfChoice}. Please install it and reload this VS Code window.`
		);
		return;
	}

	// Otherwise, prompt the user to install the language server.
	promptForMissingTool(languageServerOfChoice);
}

function allFoldersHaveSameGopath(): boolean {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length <= 1) {
		return true;
	}
	const tempGopath = getCurrentGoPath(vscode.workspace.workspaceFolders[0].uri);
	return vscode.workspace.workspaceFolders.find((x) => tempGopath !== getCurrentGoPath(x.uri)) ? false : true;
}

// registerUsualProviders registers the language feature providers if the language server is not enabled.
function registerUsualProviders(ctx: vscode.ExtensionContext) {
	const provider = new GoCompletionItemProvider(ctx.globalState);
	ctx.subscriptions.push(provider);
	ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider(GO_MODE, provider, '.', '"'));
	ctx.subscriptions.push(vscode.languages.registerHoverProvider(GO_MODE, new GoHoverProvider()));
	ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(GO_MODE, new GoDefinitionProvider()));
	ctx.subscriptions.push(vscode.languages.registerReferenceProvider(GO_MODE, new GoReferenceProvider()));
	ctx.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(GO_MODE, new GoDocumentSymbolProvider()));
	ctx.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new GoWorkspaceSymbolProvider()));
	ctx.subscriptions.push(
		vscode.languages.registerSignatureHelpProvider(GO_MODE, new GoSignatureHelpProvider(), '(', ',')
	);
	ctx.subscriptions.push(vscode.languages.registerImplementationProvider(GO_MODE, new GoImplementationProvider()));
	ctx.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(GO_MODE, new GoDocumentFormattingEditProvider())
	);
	ctx.subscriptions.push(vscode.languages.registerTypeDefinitionProvider(GO_MODE, new GoTypeDefinitionProvider()));
	ctx.subscriptions.push(vscode.languages.registerRenameProvider(GO_MODE, new GoRenameProvider()));
	vscode.workspace.onDidChangeTextDocument(parseLiveFile, null, ctx.subscriptions);
}

const defaultLatestVersion = semver.coerce('0.3.1');
const defaultLatestVersionTime = moment('2020-02-04', 'YYYY-MM-DD');
async function shouldUpdateLanguageServer(
	tool: Tool,
	languageServerToolPath: string,
	makeProxyCall: boolean
): Promise<boolean> {
	// Only support updating gopls for now.
	if (tool.name !== 'gopls') {
		return false;
	}

	// First, run the "gopls version" command and parse its results.
	// If "gopls" is so old that it doesn't have the "gopls version" command,
	// or its version doesn't match our expectations, prompt the user to download.
	const usersVersion = await goplsVersion(languageServerToolPath);
	if (!usersVersion) {
		return true;
	}

	// We might have a developer version. Don't make the user update.
	if (usersVersion === '(devel)') {
		return false;
	}

	// Get the latest gopls version. If it is for nightly, using the prereleased version is ok.
	let latestVersion = makeProxyCall ? await latestGopls(tool, isForNightly) : defaultLatestVersion;

	// If we failed to get the gopls version, pick the one we know to be latest at the time of this extension's last update
	if (!latestVersion) {
		latestVersion = defaultLatestVersion;
	}

	// The user may have downloaded golang.org/x/tools/gopls@master,
	// which means that they have a pseudoversion.
	const usersTime = parsePseudoversionTimestamp(usersVersion);
	// If the user has a pseudoversion, get the timestamp for the latest gopls version and compare.
	if (usersTime) {
		let latestTime = makeProxyCall ? await goplsVersionTimestamp(tool, latestVersion) : defaultLatestVersionTime;
		if (!latestTime) {
			latestTime = defaultLatestVersionTime;
		}
		return usersTime.isBefore(latestTime);
	}

	// If the user's version does not contain a timestamp,
	// default to a semver comparison of the two versions.
	return semver.lt(usersVersion, latestVersion);
}

// Copied from src/cmd/go/internal/modfetch.
const pseudoVersionRE = /^v[0-9]+\.(0\.0-|\d+\.\d+-([^+]*\.)?0\.)\d{14}-[A-Za-z0-9]+(\+incompatible)?$/;

// parsePseudoVersion reports whether v is a pseudo-version.
// The timestamp is the center component, and it has the format "YYYYMMDDHHmmss".

function parsePseudoversionTimestamp(version: string): moment.Moment {
	const split = version.split('-');
	if (split.length < 2) {
		return null;
	}
	if (!semver.valid(version)) {
		return null;
	}
	if (!pseudoVersionRE.test(version)) {
		return null;
	}
	const sv = semver.coerce(version);
	if (!sv) {
		return null;
	}
	// Copied from src/cmd/go/internal/modfetch.go.
	const build = sv.build.join('.');
	const buildIndex = version.lastIndexOf(build);
	if (buildIndex >= 0) {
		version = version.substring(0, buildIndex);
	}
	const lastDashIndex = version.lastIndexOf('-');
	version = version.substring(0, lastDashIndex);
	const firstDashIndex = version.lastIndexOf('-');
	const dotIndex = version.lastIndexOf('.');
	let timestamp: string;
	if (dotIndex > firstDashIndex) {
		// "vX.Y.Z-pre.0" or "vX.Y.(Z+1)-0"
		timestamp = version.substring(dotIndex + 1);
	} else {
		// "vX.0.0"
		timestamp = version.substring(firstDashIndex + 1);
	}
	return moment.utc(timestamp, 'YYYYMMDDHHmmss');
}

async function goplsVersionTimestamp(tool: Tool, version: semver.SemVer): Promise<moment.Moment> {
	const data = await goProxyRequest(tool, `v${version.format()}.info`);
	if (!data) {
		return null;
	}
	const time = moment(data['Time']);
	return time;
}

async function latestGopls(tool: Tool, includePrerelease: boolean): Promise<semver.SemVer> {
	// If the user has a version of gopls that we understand,
	// ask the proxy for the latest version, and if the user's version is older,
	// prompt them to update.
	const data = await goProxyRequest(tool, 'list');
	if (!data) {
		return null;
	}
	// Coerce the versions into SemVers so that they can be sorted correctly.
	const versions = [];
	for (const version of data.trim().split('\n')) {
		const parsed = semver.parse(version, {
			includePrerelease: true,
			loose: true
		});
		versions.push(parsed);
	}
	if (versions.length === 0) {
		return null;
	}
	versions.sort(semver.rcompare);

	if (includePrerelease) {
		return versions[0];  // The first one in the prerelease.
	}
	// The first version in the sorted list without a prerelease tag.
	return versions.find((version) => !version.prerelease || !version.prerelease.length);
}

async function goplsVersion(goplsPath: string): Promise<string> {
	const env = getToolsEnvVars();
	const execFile = util.promisify(cp.execFile);
	let output: any;
	try {
		const { stdout } = await execFile(goplsPath, ['version'], { env });
		output = stdout;
	} catch (e) {
		// The "gopls version" command is not supported, or something else went wrong.
		// TODO: Should we propagate this error?
		return null;
	}

	const lines = <string>output.trim().split('\n');
	switch (lines.length) {
		case 0:
			// No results, should update.
			// Worth doing anything here?
			return null;
		case 1:
			// Built in $GOPATH mode. Should update.
			// TODO: Should we check the Go version here?
			// Do we even allow users to enable gopls if their Go version is too low?
			return null;
		case 2:
			// We might actually have a parseable version.
			break;
		default:
			return null;
	}

	// The second line should be the sum line.
	// It should look something like this:
	//
	//    golang.org/x/tools/gopls@v0.1.3 h1:CB5ECiPysqZrwxcyRjN+exyZpY0gODTZvNiqQi3lpeo=
	//
	// TODO: We should use a regex to match this, but for now, we split on the @ symbol.
	// The reasoning for this is that gopls still has a golang.org/x/tools/cmd/gopls binary,
	// so users may have a developer version that looks like "golang.org/x/tools@(devel)".
	const moduleVersion = lines[1].trim().split(' ')[0];

	// Get the relevant portion, that is:
	//
	//    golang.org/x/tools/gopls@v0.1.3
	//
	const split = moduleVersion.trim().split('@');
	if (split.length < 2) {
		return null;
	}
	// The version comes after the @ symbol:
	//
	//    v0.1.3
	//
	return split[1];
}

async function goProxyRequest(tool: Tool, endpoint: string): Promise<any> {
	const proxies = goProxy();
	// Try each URL set in the user's GOPROXY environment variable.
	// If none is set, don't make the request.
	for (const proxy of proxies) {
		if (proxy === 'direct') {
			continue;
		}
		const url = `${proxy}/${tool.importPath}/@v/${endpoint}`;
		let data: string;
		try {
			data = await WebRequest.json<string>(url, {
				throwResponseError: true
			});
		} catch (e) {
			return null;
		}
		return data;
	}
	return null;
}

function goProxy(): string[] {
	const output: string = process.env['GOPROXY'];
	if (!output || !output.trim()) {
		return [];
	}
	const split = output.trim().split(',');
	return split;
}
