/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import fs = require('fs');
import path = require('path');
import rl = require('readline');
import vscode = require('vscode');
import { isModSupported } from './goModules';
import { getTestFlags, goTest, showTestOutput, TestConfig } from './testUtils';
import { getGoConfig, getTempFilePath } from './util';

let gutterSvgs: { [key: string]: string };
let decorators: {
	type: string;
	coveredGutterDecorator: vscode.TextEditorDecorationType;
	uncoveredGutterDecorator: vscode.TextEditorDecorationType;
	coveredHighlightDecorator: vscode.TextEditorDecorationType;
	uncoveredHighlightDecorator: vscode.TextEditorDecorationType;
};
let decoratorConfig: {
	[key: string]: any;
	type: string;
	coveredHighlightColor: string;
	uncoveredHighlightColor: string;
	coveredGutterStyle: string;
	uncoveredGutterStyle: string;
};
// a list of modified, unsaved go files with actual code edits (rather than comment edits)
let modifiedFiles: {
	[key: string]: boolean;
} = {};

/**
 * Initializes the decorators used for Code coverage.
 * @param ctx The extension context
 */
export function initCoverageDecorators(ctx: vscode.ExtensionContext) {
	// Initialize gutter svgs
	gutterSvgs = {
		blockred: ctx.asAbsolutePath('images/gutter-blockred.svg'),
		blockgreen: ctx.asAbsolutePath('images/gutter-blockgreen.svg'),
		blockblue: ctx.asAbsolutePath('images/gutter-blockblue.svg'),
		blockyellow: ctx.asAbsolutePath('images/gutter-blockyellow.svg'),
		slashred: ctx.asAbsolutePath('images/gutter-slashred.svg'),
		slashgreen: ctx.asAbsolutePath('images/gutter-slashgreen.svg'),
		slashblue: ctx.asAbsolutePath('images/gutter-slashblue.svg'),
		slashyellow: ctx.asAbsolutePath('images/gutter-slashyellow.svg'),
		verticalred: ctx.asAbsolutePath('images/gutter-vertred.svg'),
		verticalgreen: ctx.asAbsolutePath('images/gutter-vertgreen.svg'),
		verticalblue: ctx.asAbsolutePath('images/gutter-vertblue.svg'),
		verticalyellow: ctx.asAbsolutePath('images/gutter-vertyellow.svg')
	};

	// Update the coverageDecorator in User config, if they are using the old style.
	const goConfig = getGoConfig();
	const inspectResult = goConfig.inspect('coverageDecorator');
	if (inspectResult) {
		if (typeof inspectResult.globalValue === 'string') {
			goConfig.update(
				'coverageDecorator',
				{ type: inspectResult.globalValue },
				vscode.ConfigurationTarget.Global
			);
		}
		if (typeof inspectResult.workspaceValue === 'string') {
			goConfig.update(
				'coverageDecorator',
				{ type: inspectResult.workspaceValue },
				vscode.ConfigurationTarget.Workspace
			);
		}
		if (typeof inspectResult.workspaceFolderValue === 'string') {
			goConfig.update(
				'coverageDecorator',
				{ type: inspectResult.workspaceValue },
				vscode.ConfigurationTarget.WorkspaceFolder
			);
		}
	}

	// Update the decorators
	updateCodeCoverageDecorators(goConfig.get('coverageDecorator'));
}

/**
 * Updates the decorators used for Code coverage.
 * @param coverageDecoratorConfig The coverage decorated as configured by the user
 */
export function updateCodeCoverageDecorators(coverageDecoratorConfig: any) {
	// These defaults are chosen to be distinguishable in nearly any color scheme (even Red)
	// as well as by people who have difficulties with color perception.
	decoratorConfig = {
		type: 'highlight',
		coveredHighlightColor: 'rgba(64,128,128,0.5)',
		uncoveredHighlightColor: 'rgba(128,64,64,0.25)',
		coveredGutterStyle: 'blockblue',
		uncoveredGutterStyle: 'slashyellow'
	};

	// Update from configuration
	if (typeof coverageDecoratorConfig === 'string') {
		decoratorConfig.type = coverageDecoratorConfig;
	} else {
		for (const k in coverageDecoratorConfig) {
			if (coverageDecoratorConfig.hasOwnProperty(k)) {
				decoratorConfig[k] = coverageDecoratorConfig[k];
			}
		}
	}
	setDecorators();
	vscode.window.visibleTextEditors.forEach(applyCodeCoverage);
}

function setDecorators() {
	disposeDecorators();
	decorators = {
		type: decoratorConfig.type,
		coveredGutterDecorator: vscode.window.createTextEditorDecorationType({
			gutterIconPath: gutterSvgs[decoratorConfig.coveredGutterStyle]
		}),
		uncoveredGutterDecorator: vscode.window.createTextEditorDecorationType({
			gutterIconPath: gutterSvgs[decoratorConfig.uncoveredGutterStyle]
		}),
		coveredHighlightDecorator: vscode.window.createTextEditorDecorationType({
			backgroundColor: decoratorConfig.coveredHighlightColor
		}),
		uncoveredHighlightDecorator: vscode.window.createTextEditorDecorationType({
			backgroundColor: decoratorConfig.uncoveredHighlightColor
		})
	};
}

/**
 * Disposes decorators so that the current coverage is removed from the editor.
 */
function disposeDecorators() {
	if (decorators) {
		decorators.coveredGutterDecorator.dispose();
		decorators.uncoveredGutterDecorator.dispose();
		decorators.coveredHighlightDecorator.dispose();
		decorators.uncoveredHighlightDecorator.dispose();
	}
}

interface CoverageData {
	uncoveredRange: vscode.Range[];
	coveredRange: vscode.Range[];
}

let coverageFiles: { [key: string]: CoverageData } = {};
let isCoverageApplied: boolean = false;

/**
 * Clear the coverage on all files
 */
function clearCoverage() {
	coverageFiles = {};
	disposeDecorators();
	isCoverageApplied = false;
}

/**
 * Extract the coverage data from the given cover profile & apply them on the files in the open editors.
 * @param coverProfilePath Path to the file that has the cover profile data
 * @param packageDirPath Absolute path of the package for which the coverage was calculated
 */
export function applyCodeCoverageToAllEditors(coverProfilePath: string, packageDirPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		try {
			// Clear existing coverage files
			clearCoverage();

			const lines = rl.createInterface({
				input: fs.createReadStream(coverProfilePath),
				output: undefined
			});

			lines.on('line', (data: string) => {
				// go test coverageprofile generates output:
				//    filename:StartLine.StartColumn,EndLine.EndColumn Hits CoverCount
				// The first line will be "mode: set" which will be ignored
				const fileRange = data.match(/([^:]+)\:([\d]+)\.([\d]+)\,([\d]+)\.([\d]+)\s([\d]+)\s([\d]+)/);
				if (!fileRange) {
					return;
				}

				const filePath = path.join(packageDirPath, path.basename(fileRange[1]));
				const coverage = getCoverageData(filePath);
				const range = new vscode.Range(
					// Start Line converted to zero based
					parseInt(fileRange[2], 10) - 1,
					// Start Column converted to zero based
					parseInt(fileRange[3], 10) - 1,
					// End Line converted to zero based
					parseInt(fileRange[4], 10) - 1,
					// End Column converted to zero based
					parseInt(fileRange[5], 10) - 1
				);
				// If is Covered (CoverCount > 0)
				if (parseInt(fileRange[7], 10) > 0) {
					coverage.coveredRange.push(range);
				} else {
					coverage.uncoveredRange.push(range);
				}
				setCoverageData(filePath, coverage);
			});
			lines.on('close', () => {
				setDecorators();
				vscode.window.visibleTextEditors.forEach(applyCodeCoverage);
				resolve();
			});
		} catch (e) {
			vscode.window.showInformationMessage(e.msg);
			reject(e);
		}
	});
}

/**
 * Get the object that holds the coverage data for given file path.
 * @param filePath
 */
function getCoverageData(filePath: string): CoverageData {
	if (filePath.startsWith('_')) {
		filePath = filePath.substr(1);
	}
	if (process.platform === 'win32') {
		const parts = filePath.split('/');
		if (parts.length) {
			filePath = parts.join(path.sep);
		}
	}
	return coverageFiles[filePath] || { coveredRange: [], uncoveredRange: [] };
}

/**
 * Set the object that holds the coverage data for given file path.
 * @param filePath
 * @param data
 */
function setCoverageData(filePath: string, data: CoverageData) {
	if (filePath.startsWith('_')) {
		filePath = filePath.substr(1);
	}
	if (process.platform === 'win32') {
		const parts = filePath.split('/');
		if (parts.length) {
			filePath = parts.join(path.sep);
		}
	}
	coverageFiles[filePath] = data;
}

/**
 * Apply the code coverage highlighting in given editor
 * @param editor
 */
export function applyCodeCoverage(editor: vscode.TextEditor) {
	if (!editor || editor.document.languageId !== 'go' || editor.document.fileName.endsWith('_test.go')) {
		return;
	}

	const cfg = getGoConfig(editor.document.uri);
	const coverageOptions = cfg['coverageOptions'];
	for (const filename in coverageFiles) {
		if (editor.document.uri.fsPath.endsWith(filename)) {
			isCoverageApplied = true;
			const coverageData = coverageFiles[filename];
			if (coverageOptions === 'showCoveredCodeOnly' || coverageOptions === 'showBothCoveredAndUncoveredCode') {
				editor.setDecorations(
					decorators.type === 'gutter'
						? decorators.coveredGutterDecorator
						: decorators.coveredHighlightDecorator,
					coverageData.coveredRange
				);
			}

			if (coverageOptions === 'showUncoveredCodeOnly' || coverageOptions === 'showBothCoveredAndUncoveredCode') {
				editor.setDecorations(
					decorators.type === 'gutter'
						? decorators.uncoveredGutterDecorator
						: decorators.uncoveredHighlightDecorator,
					coverageData.uncoveredRange
				);
			}
		}
	}
}

/**
 * Listener for file save that clears potential stale coverage data.
 * Local cache tracks files with changes outside of comments to determine
 * files for which the save event can cause stale coverage data.
 * @param e TextDocument
 */
export function removeCodeCoverageOnFileSave(e: vscode.TextDocument) {
	if (e.languageId !== 'go' || !isCoverageApplied) {
		return;
	}

	if (vscode.window.visibleTextEditors.every((editor) => editor.document !== e)) {
		return;
	}

	if (modifiedFiles[e.fileName]) {
		clearCoverage();
		modifiedFiles = {}; // reset the list of modified files
	}
}

/**
 * Listener for file change that tracks files with changes outside of comments
 * to determine files for which an eventual save can cause stale coverage data.
 * @param e TextDocumentChangeEvent
 */
export function trackCodeCoverageRemovalOnFileChange(e: vscode.TextDocumentChangeEvent) {
	if (e.document.languageId !== 'go' || !e.contentChanges.length || !isCoverageApplied) {
		return;
	}

	if (vscode.window.visibleTextEditors.every((editor) => editor.document !== e.document)) {
		return;
	}

	if (isPartOfComment(e)) {
		return;
	}

	modifiedFiles[e.document.fileName] = true;
}

/**
 * If current editor has Code coverage applied, then remove it.
 * Else run tests to get the coverage and apply.
 */
export async function toggleCoverageCurrentPackage() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}

	if (isCoverageApplied) {
		clearCoverage();
		return;
	}

	const goConfig = getGoConfig();
	const cwd = path.dirname(editor.document.uri.fsPath);

	const testFlags = getTestFlags(goConfig);
	const isMod = await isModSupported(editor.document.uri);
	const testConfig: TestConfig = {
		goConfig,
		dir: cwd,
		flags: testFlags,
		background: true,
		isMod,
		applyCodeCoverage: true
	};

	return goTest(testConfig).then((success) => {
		if (!success) {
			showTestOutput();
		}
	});
}

export function isPartOfComment(e: vscode.TextDocumentChangeEvent): boolean {
	return e.contentChanges.every((change) => {
		// We cannot be sure with using just regex on individual lines whether a multi line change is part of a comment or not
		// So play it safe and treat it as not a comment
		if (!change.range.isSingleLine || change.text.includes('\n')) {
			return false;
		}

		const text = e.document.lineAt(change.range.start).text;
		const idx = text.search('//');
		return idx > -1 && idx <= change.range.start.character;
	});
}
