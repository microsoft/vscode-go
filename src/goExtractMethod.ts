/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import { window, Position, Selection, Range, TextEditor } from 'vscode';
import { getBinPath } from './goPath';
import { EditTypes, Edit, GetEditsFromDiffs } from './util';
import cp = require('child_process');
import dmp = require('diff-match-patch');

/**
 * Extracts method out of current selection and replaces the current selection with a call to the extracted method.
 */
export function extractMethod() {

	let editor = window.activeTextEditor;
	if (!editor) {
		window.showInformationMessage('No editor is active.');
		return;
	}
	if (editor.selections.length !== 1) {
		window.showInformationMessage('You need to have a single selection for extracting method');
		return;
	}

	let showInputBoxPromise = window.showInputBox({placeHolder: 'Please enter the name for the extracted method'});
	showInputBoxPromise.then((methodName: string) => {
		extractMethodUsingGoDoctor(methodName, editor.selection, editor).then(errorMessage => {
			if (errorMessage) {
				window.showErrorMessage(errorMessage);
			}
		});
	});
}

/**
 * Extracts method out of current selection and replaces the current selection with a call to the extracted method using godoctor.
 *
 * @param methodName name for the extracted method
 * @param selection the editor selection from which method is to be extracted
 * @param editor the editor that will be used to apply the changes from godoctor
 * @returns errorMessage in case the method fails, null otherwise
 */
export function extractMethodUsingGoDoctor(methodName: string, selection: Selection, editor: TextEditor): Thenable<string> {
	let godoctor = getBinPath('godoctor');
	let position = `${selection.start.line + 1},${selection.start.character + 1}:${selection.end.line + 1},${selection.end.character + 1}`;

	return new Promise((resolve, reject) => {
		let process = cp.execFile(godoctor, ['-pos', position, 'extract', methodName], {}, (err, stdout, stderr) => {
			if (err) {
				let errorMessageIndex = stderr.indexOf('Error:');
				return resolve(errorMessageIndex > -1 ? stderr.substr(errorMessageIndex) : stderr);
			}

			let d = new dmp.diff_match_patch();
			let patchText = stdout.substr(stdout.indexOf('@@'));
			let patches: dmp.Patch[];

			try {
				patches = d.patch_fromText(patchText);
			}
			catch (e) {
				return resolve(`Failed to parse the patches from godoctor: ${e.message}`);
			}

			applypatches(patches, editor).then(validEdit => {
				return resolve (validEdit ? null : 'Edits could not be applied to the document');
			});

		});
		process.stdin.end(editor.document.getText());
	});
}

/**
 * Applies the given set of patches to the document in the given editor
 *
 * @param patches array of patches to be applied
 * @param editor the TextEditor whose document will be updated
 */
function applypatches(patches: dmp.Patch[], editor: TextEditor): Thenable<boolean> {
	let totalEdits: Edit[] = [];
	patches.reverse().forEach((patch: dmp.Patch) => {
		// Godoctor provides a diff for each line, but the text accompanying the diff does not end with '\n'
		// GetEditsFromDiffs(..) expects the '\n' to exist in the text wherever there is a new line.
		// So add one for each diff from getdoctor
		for (let i = 0; i < patch.diffs.length; i++) {
			patch.diffs[i][1] += '\n';
		}
		let edits = GetEditsFromDiffs(patch.diffs, patch.start1);
		totalEdits = totalEdits.concat(edits);
	});

	return editor.edit((editBuilder) => {
		totalEdits.forEach((edit) => {
			switch (edit.action) {
				case EditTypes.EDIT_INSERT:
					editBuilder.insert(edit.start, edit.text);
					break;
				case EditTypes.EDIT_DELETE:
					editBuilder.delete(new Range(edit.start, edit.end));
					break;
				case EditTypes.EDIT_REPLACE:
					editBuilder.replace(new Range(edit.start, edit.end), edit.text);
					break;
			}
		});
	});
}



