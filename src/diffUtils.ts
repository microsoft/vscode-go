/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import jsDiff = require('diff');
import { Position, Range, TextEditorEdit, Uri, WorkspaceEdit } from 'vscode';
import { getBinPathFromEnvVar } from './goPath';

let diffToolAvailable: boolean | null = null;

export function isDiffToolAvailable(): boolean {
	if (diffToolAvailable == null) {
		const envPath = process.env['PATH'] || (process.platform === 'win32' ? process.env['Path'] : null);
		if (!envPath) {
			return false;
		}
		diffToolAvailable = getBinPathFromEnvVar('diff', envPath, false) != null;
	}
	return diffToolAvailable;
}

export enum EditTypes {
	EDIT_DELETE,
	EDIT_INSERT,
	EDIT_REPLACE
}

export class Edit {
	public start: Position;
	public end: Position;
	public text: string;
	private action: number;

	constructor(action: number, start: Position) {
		this.action = action;
		this.start = start;
		this.text = '';
	}

	// Applies Edit using given TextEditorEdit
	public applyUsingTextEditorEdit(editBuilder: TextEditorEdit): void {
		switch (this.action) {
			case EditTypes.EDIT_INSERT:
				editBuilder.insert(this.start, this.text);
				break;

			case EditTypes.EDIT_DELETE:
				editBuilder.delete(new Range(this.start, this.end));
				break;

			case EditTypes.EDIT_REPLACE:
				editBuilder.replace(new Range(this.start, this.end), this.text);
				break;
		}
	}

	// Applies Edits to given WorkspaceEdit
	public applyUsingWorkspaceEdit(workspaceEdit: WorkspaceEdit, fileUri: Uri): void {
		switch (this.action) {
			case EditTypes.EDIT_INSERT:
				workspaceEdit.insert(fileUri, this.start, this.text);
				break;

			case EditTypes.EDIT_DELETE:
				workspaceEdit.delete(fileUri, new Range(this.start, this.end));
				break;

			case EditTypes.EDIT_REPLACE:
				workspaceEdit.replace(fileUri, new Range(this.start, this.end), this.text);
				break;
		}
	}
}

export interface FilePatch {
	fileName: string;
	edits: Edit[];
}

/**
 * Uses diff module to parse given array of IUniDiff objects and returns edits for files
 *
 * @param diffOutput jsDiff.IUniDiff[]
 *
 * @returns Array of FilePatch objects, one for each file
 */
function parseUniDiffs(diffOutput: jsDiff.IUniDiff[]): FilePatch[] {
	const filePatches: FilePatch[] = [];
	diffOutput.forEach((uniDiff: jsDiff.IUniDiff) => {
		let edit: Edit;
		const edits: Edit[] = [];
		uniDiff.hunks.forEach((hunk: jsDiff.IHunk) => {
			let startLine = hunk.oldStart;
			hunk.lines.forEach((line) => {
				switch (line.substr(0, 1)) {
					case '-':
						edit = new Edit(EditTypes.EDIT_DELETE, new Position(startLine - 1, 0));
						edit.end = new Position(startLine, 0);
						edits.push(edit);
						startLine++;
						break;
					case '+':
						edit = new Edit(EditTypes.EDIT_INSERT, new Position(startLine - 1, 0));
						edit.text += line.substr(1) + '\n';
						edits.push(edit);
						break;
					case ' ':
						startLine++;
						break;
				}
			});
		});

		const fileName = uniDiff.oldFileName;
		filePatches.push({ fileName, edits });
	});

	return filePatches;
}

/**
 * Returns a FilePatch object by generating diffs between given oldStr and newStr using the diff module
 *
 * @param fileName string: Name of the file to which edits should be applied
 * @param oldStr string
 * @param newStr string
 *
 * @returns A single FilePatch object
 */
export function getEdits(fileName: string, oldStr: string, newStr: string): FilePatch {
	if (process.platform === 'win32') {
		oldStr = oldStr.split('\r\n').join('\n');
		newStr = newStr.split('\r\n').join('\n');
	}
	const unifiedDiffs: jsDiff.IUniDiff = jsDiff.structuredPatch(fileName, fileName, oldStr, newStr, '', '');
	const filePatches: FilePatch[] = parseUniDiffs([unifiedDiffs]);
	return filePatches[0];
}

/**
 * Uses diff module to parse given diff string and returns edits for files
 *
 * @param diffStr : Diff string in unified format.
 * http://www.gnu.org/software/diffutils/manual/diffutils.html#Unified-Format
 *
 * @returns Array of FilePatch objects, one for each file
 */
export function getEditsFromUnifiedDiffStr(diffstr: string): FilePatch[] {
	const unifiedDiffs: jsDiff.IUniDiff[] = jsDiff.parsePatch(diffstr);
	const filePatches: FilePatch[] = parseUniDiffs(unifiedDiffs);
	return filePatches;
}
