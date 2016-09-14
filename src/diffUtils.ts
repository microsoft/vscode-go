/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import { TextDocument, Position, Range, TextEdit, Uri, WorkspaceEdit, TextEditorEdit } from 'vscode';
let parse = require('diff-parse');

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

	// Creates TextEdit for current Edit
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

	// Applies Edit using given TextEditorEdit
	applyUsingTextEditorEdit(editBuilder: TextEditorEdit): void {
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
	applyUsingWorkspaceEdit(workspaceEdit: WorkspaceEdit, fileUri: Uri): void {
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

export interface FileEdits {
	fileName: string;
	edits: Edit[];
}

/**
 * Uses diff-parse module to parse given diff output and returns edits across multiple files
 *
 * @param diffOutput string
 */

export function parseDiffOutput(diffOutput: string): FileEdits[] {
	let files = parse(diffOutput);
	let fileEditsToReturn: FileEdits[] = [];

	files.forEach(function(file) {

		// Position/Ranges in TextEdits should be relative to original document
		// Deletes from diff-parse give line number from the original document to be deleted
		// But Inserts from diff-parse give line number assuming previous edits are applied.
		// The no-changes from diff-parse give both before and after line numbers.
		// This before line number can be used for tracking the right line number for inserts.
		let lineInOriginalFile: number = undefined;

		let edit: Edit = null;
		let edits: Edit[] = [];

		file.lines.forEach(function(line) {
			switch (line.type) {
				case 'chunk':
					break;
				case 'del':
					if (edit == null) {
						edit = new Edit(EditTypes.EDIT_DELETE, new Position(line.ln - 1, 0));
					}
					edit.end = new Position(line.ln, 0);
					break;

				case 'add':
					if (edit == null) {
						let startLine = lineInOriginalFile === undefined ? line.ln - 1 : lineInOriginalFile;
						edit = new Edit(EditTypes.EDIT_INSERT, new Position(startLine, 0));
					} else if (edit.action === EditTypes.EDIT_DELETE) {
						edit.action = EditTypes.EDIT_REPLACE;
					}
					edit.text += line.content + '\n';
					break;

				case 'normal':
					if (edit != null) {
						edits.push(edit);
					}
					edit = null;
					lineInOriginalFile = line.ln1;
					break;
			}
		});

		if (edit != null) {
			edits.push(edit);
		}

		fileEditsToReturn.push({fileName: file.from, edits: edits});
	});

	return fileEditsToReturn;
}