/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import { TextDocument, Position, TextEdit, Range, Uri, WorkspaceEdit } from 'vscode';
import path = require('path');
import dmp = require('diff-match-patch');

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
	imports: Array<{ kind: string; start: number; end: number; }>;
	pkg: { start: number; end: number; };
}

export function parseFilePrelude(text: string): Prelude {
	let lines = text.split('\n');
	let ret: Prelude = { imports: [], pkg: null };
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (line.match(/^(\s)*package(\s)+/)) {
			ret.pkg = { start: i, end: i };
		}
		if (line.match(/^(\s)*import(\s)+\(/)) {
			ret.imports.push({ kind: 'multi', start: i, end: -1 });
		}
		if (line.match(/^(\s)*import(\s)+[^\(]/)) {
			ret.imports.push({ kind: 'single', start: i, end: i });
		}
		if (line.match(/^(\s)*\)/)) {
			if (ret.imports[ret.imports.length - 1].end === -1) {
				ret.imports[ret.imports.length - 1].end = i;
			}
		}
		if (line.match(/^(\s)*(func|const|type|var)/)) {
			break;
		}
	}
	return ret;
}

// Takes a Go function signature like:
//     (foo, bar string, baz number) (string, string)
// and returns an array of parameter strings:
//     ["foo", "bar string", "baz string"]
// Takes care of balancing parens so to not get confused by signatures like:
//     (pattern string, handler func(ResponseWriter, *Request)) {
export function parameters(signature: string): string[] {
	let ret: string[] = [];
	let parenCount = 0;
	let lastStart = 1;
	for (let i = 1; i < signature.length; i++) {
		switch (signature[i]) {
			case '(':
				parenCount++;
				break;
			case ')':
				parenCount--;
				if (parenCount < 0) {
					if (i > lastStart) {
						ret.push(signature.substring(lastStart, i));
					}
					return ret;
				}
				break;
			case ',':
				if (parenCount === 0) {
					ret.push(signature.substring(lastStart, i));
					lastStart = i + 2;
				}
				break;
		}
	}
	return null;
}

export function canonicalizeGOPATHPrefix(filename: string): string {
		let gopath: string = process.env['GOPATH'];
		if (!gopath) return filename;
		let workspaces = gopath.split(path.delimiter);
		let filenameLowercase = filename.toLowerCase();
		for (let workspace of workspaces) {
			if (filenameLowercase.substring(0, workspace.length) === workspace.toLowerCase()) {
				return workspace + filename.slice(workspace.length);
			}
		}
		return filename;
	}

export interface FilePatch {
	uri: Uri,
	edits: Edit[]
}

export enum EditTypes { EDIT_DELETE, EDIT_INSERT, EDIT_REPLACE};

export class Edit {
	action: number;
	start: Position;
	end: Position;
	text: string;

	constructor(action: number, start: Position) {
		this.action = action;
		this.start = start;
		this.text = '';
	}

	apply(): TextEdit {
		switch (this.action) {
			case EditTypes.EDIT_INSERT:
				return TextEdit.insert(this.start, this.text);
			case EditTypes.EDIT_DELETE:
				return TextEdit.delete(new Range(this.start, this.end));
			case EditTypes.EDIT_REPLACE:
				return TextEdit.replace(new Range(this.start, this.end), this.text);
		}
	}

	applyToWorkspaceEdit(result: WorkspaceEdit, fileUri:Uri): void {
		switch(this.action) {
			case EditTypes.EDIT_INSERT:
				result.insert(fileUri, this.start, this.text);
				break;
			case EditTypes.EDIT_DELETE:
				result.delete(fileUri, new Range(this.start, this.end));
				break;
			case EditTypes.EDIT_REPLACE:
				result.replace(fileUri, new Range(this.start, this.end), this.text);
				break;
		}
	}
}

/**
 * Gets Edits from given diff array
 *
 * @param diffs The array of diffs which are translated to edits
 * @param line The line number from where the edits are to be applied
 * @param isEachDiffSeparateLine boolean that denotes if each diff corresponds to a complete separate line
 * @returns Array of Edits that can be applied to the document
 */
export function GetEditsFromDiffs(diffs: dmp.Diff[], line: number, isEachDiffSeparateLine: boolean = false): Edit[] {
	let character = 0;
	let edits: Edit[] = [];
	let edit: Edit = null;

	for (let i = 0; i < diffs.length; i++) {
		let start = new Position(line, character);

		// Compute the line/character after the diff is applied.
		if (isEachDiffSeparateLine){
			diffs[i][1] += '\n';
			line++;
		} else {
			for (let curr = 0; curr < diffs[i][1].length; curr++) {
				if (diffs[i][1][curr] !== '\n') {
					character++;
				} else {
					character = 0;
					line++;
				}
			}
		}

		switch (diffs[i][0]) {
			case dmp.DIFF_DELETE:
				if (edit == null) {
					edit = new Edit(EditTypes.EDIT_DELETE, start);
				} else if (edit.action !== EditTypes.EDIT_DELETE) {
					return null;
				}
				edit.end = new Position(line, character);
				break;

			case dmp.DIFF_INSERT:
				if (edit == null) {
					edit = new Edit(EditTypes.EDIT_INSERT, start);
				} else if (edit.action === EditTypes.EDIT_DELETE) {
					edit.action = EditTypes.EDIT_REPLACE;
				}
				// insert and replace edits are all relative to the original state
				// of the document, so inserts should reset the current line/character
				// position to the start.
				line = start.line;
				character = start.character;
				edit.text += diffs[i][1];
				break;

			case dmp.DIFF_EQUAL:
				if (edit != null) {
					edits.push(edit);
					edit = null;
				}
				break;
		}
	}

	if (edit != null) {
		edits.push(edit);
	}

	return edits;
}

/**
 * Applies patch_fromText on given patch text to get patches and then returns edits for each of the patches
 * 
 * @param patchText: Text starting with @@ following the Unified format for patches.
 * Read more http://www.gnu.org/software/diffutils/manual/diffutils.html#Unified-Format
 */
function GetEditsFromPatchText(patchText: string): Edit[] {
		let d = new dmp.diff_match_patch();
		let patches = d.patch_fromText(patchText);
		let totalEdits: Edit[] = [];

		for(var i = patches.length - 1; i >= 0; i--){
			let edits = GetEditsFromDiffs(patches[i].diffs, patches[i].start1, true);
			if (!edits){
				return null;
			}
			totalEdits = totalEdits.concat(edits);
		}
		
		return totalEdits;
}


/**
 * Parses diff output in the Unified format to return edits for each file 
 * Read more http://www.gnu.org/software/diffutils/manual/diffutils.html#Unified-Format
 * 
 * @param diffOutput Text starting with --- following the Unified format for patches.
 */
export function ParseDiffOutput(diffOutput: string): FilePatch[] {
	// patches_fromText doesnt work with \r\n
	diffOutput = diffOutput.split('\r\n').join('\n');

	let allFilePatches: FilePatch[] = [];
	let currentUri : Uri = null;
	let currentPatchText: string[] = [];
	let diffOutputLines = diffOutput.split('\n');

	// Refer to http://www.gnu.org/software/diffutils/manual/diffutils.html#Unified-Format to understand what we are trying to parse here
	diffOutputLines.forEach(line => {
		if(line.startsWith('---')){
			if (currentPatchText.length > 0){
				allFilePatches.push({
					uri: currentUri,
					edits: GetEditsFromPatchText(currentPatchText.join('\n'))
				})
				currentPatchText = [];
				currentUri = null;
			}
			let regex = /(--- )(.*)(\t)([\d]{4}-\d\d-\d\d \d\d:\d\d:\d\d.[\d]{9} -[\d]{4})/g;
			var matches = regex.exec(line);
			if (matches && matches.length == 5){
				currentUri = Uri.file(matches[2]);
			} 
		} else if (!line.startsWith('+++')){
			if (!line.startsWith('@@') && line.length > 1){
				// patch_fromText expects encoded text
				line = line.charAt(0) + encodeURI(line.substring(1));
			}
			currentPatchText.push(line);
		}
	});
	if (currentPatchText.length > 0){
		allFilePatches.push({
			uri: currentUri,
			edits: GetEditsFromPatchText(currentPatchText.join('\n'))
		})
	}

	return allFilePatches;
}