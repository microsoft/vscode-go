/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import { window, Position, Selection, Range, TextEditor } from 'vscode';
import { getBinPath } from './goPath';
import { EditTypes, Edit } from './util';
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
	if (editor.selections.length != 1){
		window.showInformationMessage('You need to have a single selection for extracting method');
		return;
	}
		
	let showInputBoxPromise = window.showInputBox({placeHolder: 'Please enter the name for the extracted method'});
	showInputBoxPromise.then((methodName: string) => {		

		// Ensure there is always an eol char at the end of the document	
		// Else "No End of Line" char gets added by godoctor which will fail diff_match_patch.patch_fromtext()
		let editPromise: Thenable<boolean>;
		if(!editor.document.getText().endsWith("\n")){			
			editPromise = editor.edit((editBuilder) => {
				editBuilder.insert(new Position(editor.document.lineCount, 0), "\n");
			});
		} else {
			editPromise = Promise.resolve(true);
		}
	
		editPromise.then((validEdit) => {
			if (!validEdit) {
				window.showErrorMessage('Edits could not be applied to the document');
				return;
			}
			extractMethodUsingGoDoctor(methodName, editor.selection, editor).then(errorMessage => {
				if (errorMessage){
					window.showErrorMessage(errorMessage);
				}
			});;
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
export function extractMethodUsingGoDoctor(methodName: string, selection: Selection, editor: TextEditor): Thenable<string>{
	let godoctor = getBinPath('godoctor');		
	let position = `${selection.start.line + 1},${selection.start.character + 1}:${selection.end.line + 1},${selection.end.character + 1}`;
	
	return new Promise((resolve, reject) => {
		var process = cp.execFile(godoctor, ['-pos', position, 'extract', methodName], {},(err, stdout, stderr) => {
			if (err){
				var errorMessageIndex = stderr.indexOf('Error:');				
				return resolve(errorMessageIndex > -1 ? stderr.substr(errorMessageIndex) : stderr);				
			}	
			
			let d = new dmp.diff_match_patch();
			let patchText = stdout.substr(stdout.indexOf('@@'));
			let patches: dmp.Patch[];
			
			try {
				patches = d.patch_fromText(patchText);
			}
			catch(e){	
				return resolve(`Failed to parse the patches from godoctor: ${e.message}`);
			}
					
			applypatches(patches, editor).then(validEdit => {
				return resolve (validEdit? null: 'Edits could not be applied to the document');				
			});;
				
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
function applypatches(patches: dmp.Patch[], editor: TextEditor): Thenable<boolean>{
	let totalEdits: Edit[] = [];	
	patches.reverse().forEach((patch: dmp.Patch) => {
		let edits = getEditsFromPatch(patch);
		totalEdits = totalEdits.concat(edits);
	})
	var editPromise = editor.edit((editBuilder) => {		
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
		})			
	})
	return editPromise;	
}

/**
 * Gets Edits from given patch
 * 
 * @param patch The patch from which the diffs are translated to edits
 * @returns Array of Edits that can be applied to the document
 */
function getEditsFromPatch(patch: dmp.Patch): Edit[]{
	let line: number = patch.start1;
	let edits: Edit[] = [];
	let edit: Edit = null;	
	
	// Loop through each diff, coalesce consecutive inserts/deletes into single edit of type insert/delete
	// If insert follows a delete, then create a edit of type replace
	for (let i = 0; i < patch.diffs.length; i++) {		
		switch (patch.diffs[i][0]) {
			case dmp.DIFF_DELETE:
				if (edit == null) {					
					edit = new Edit(EditTypes.EDIT_DELETE, new Position(line, 0));
				} 
				edit.end = new Position(line, patch.diffs[i][1].length);	
				line++;								
				break;
			case dmp.DIFF_INSERT:
				if (edit == null) {					
					edit = new Edit(EditTypes.EDIT_INSERT, new Position(line, 0));
				} else if (edit.action === EditTypes.EDIT_DELETE) {
					edit.action = EditTypes.EDIT_REPLACE;					
				} else {
					edit.text += "\n";
				}
				if (edit.action == EditTypes.EDIT_INSERT){
					line++;
				}
				edit.text += patch.diffs[i][1];
				break;

			case dmp.DIFF_EQUAL:
				if (edit != null) {
					edits.push(edit);
					edit = null;					
				}	
				line++;							
				break;
		}				
	}

	if (edit != null) {
		edits.push(edit);
	}

	return edits;

	
}


