/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { GoHoverProvider } from '../src/goExtraInfo';
import { GoCompletionItemProvider } from '../src/goSuggest';
import { GoSignatureHelpProvider } from '../src/goSignature';
import { check } from '../src/goCheck';
import cp = require('child_process');
import { parseDiffOutput_using_diff_parse, parseDiffOutput } from '../src/diffUtils';
import jsDiff = require('diff');

suite('Go Extension Tests', () => {
	let gopath = process.env['GOPATH'];
	let repoPath = path.join(gopath, 'src', '___testrepo');
	let fixturePath = path.join(repoPath, 'test', 'testfixture');
	let fixtureSourcePath = path.join(__dirname, '..', '..', 'test', 'fixtures');

	suiteSetup(() => {
		assert.ok(gopath !== null, 'GOPATH is not defined');
		fs.removeSync(repoPath);
		fs.mkdirsSync(fixturePath);
		fs.copySync(path.join(fixtureSourcePath, 'test.go'), path.join(fixturePath, 'test.go'));
		fs.copySync(path.join(fixtureSourcePath, 'errors.go'), path.join(fixturePath, 'errors.go'));
	});

	suiteTeardown(() => {
		fs.removeSync(repoPath);
	});

	test('Test Hover Provider', (done) => {
		let provider = new GoHoverProvider();
		let printlnDoc = `Println formats using the default formats for its operands and writes to
standard output. Spaces are always added between operands and a newline
is appended. It returns the number of bytes written and any write error
encountered.
`;
		let testCases: [vscode.Position, string, string][] = [
			// [new vscode.Position(3,3), '/usr/local/go/src/fmt'],
			[new vscode.Position(9, 6), 'main func()', null],
			[new vscode.Position(7, 2), 'import (fmt "fmt")', null],
			[new vscode.Position(7, 6), 'Println func(a ...interface{}) (n int, err error)', printlnDoc],
			[new vscode.Position(10, 3), 'print func(txt string)', null]
		];
		let uri = vscode.Uri.file(path.join(fixturePath, 'test.go'));
		vscode.workspace.openTextDocument(uri).then((textDocument) => {
			let promises = testCases.map(([position, expectedSignature, expectedDocumentation]) =>
				provider.provideHover(textDocument, position, null).then(res => {
					// TODO: Documentation appears to currently be broken on Go 1.7, so disabling these tests for now
					// if (expectedDocumentation === null) {
					//  assert.equal(res.contents.length, 1);
					// } else {
					// 	assert.equal(res.contents.length, 2);
					// 	assert.equal(expectedDocumentation, <string>(res.contents[0]));
					// }
					assert.equal(expectedSignature, (<{ language: string; value: string }>res.contents[res.contents.length - 1]).value);
				})
			);
			return Promise.all(promises);
		}, (err) => {
			assert.ok(false, `error in OpenTextDocument ${err}`);
		}).then(() => done(), done);
	});

	test('Test Completion', (done) => {
		let provider = new GoCompletionItemProvider();
		let testCases: [vscode.Position, string[]][] = [
			[new vscode.Position(1, 0), []],
			[new vscode.Position(4, 1), ['main', 'print', 'fmt']],
			[new vscode.Position(7, 4), ['fmt']],
			[new vscode.Position(8, 0), ['main', 'print', 'fmt', 'txt']]
		];
		let uri = vscode.Uri.file(path.join(fixturePath, 'test.go'));
		vscode.workspace.openTextDocument(uri).then((textDocument) => {
			let promises = testCases.map(([position, expected]) =>
				provider.provideCompletionItems(textDocument, position, null).then(items => {
					let labels = items.map(x => x.label);
					for (let entry of expected) {
						if (labels.indexOf(entry) < 0) {
							assert.fail('', entry, 'missing expected item in competion list');
						}
					}
				})
			);
			return Promise.all(promises);
		}, (err) => {
			assert.ok(false, `error in OpenTextDocument ${err}`);
		}).then(() => done(), done);
	});

	test('Test Signature Help', (done) => {
		let provider = new GoSignatureHelpProvider();
		let testCases: [vscode.Position, string][] = [
			[new vscode.Position(7, 13), 'Println(a ...interface{}) (n int, err error)'],
			[new vscode.Position(10, 7), 'print(txt string)']
		];
		let uri = vscode.Uri.file(path.join(fixturePath, 'test.go'));
		vscode.workspace.openTextDocument(uri).then((textDocument) => {
			let promises = testCases.map(([position, expected]) =>
				provider.provideSignatureHelp(textDocument, position, null).then(sigHelp => {
					assert.equal(sigHelp.signatures.length, 1, 'unexpected number of overloads');
					assert.equal(sigHelp.signatures[0].label, expected);
				})
			);
			return Promise.all(promises);
		}, (err) => {
			assert.ok(false, `error in OpenTextDocument ${err}`);
		}).then(() => done(), done);
	});

	test('Error checking', (done) => {
		let config = vscode.workspace.getConfiguration('go');
		let expected = [
			{ line: 7, severity: 'warning', msg: 'exported function Print2 should have comment or be unexported' },
			// { line: 7, severity: 'warning', msg: 'no formatting directive in Printf call' },
			{ line: 11, severity: 'error', msg: 'undefined: prin' },
		];
		check(path.join(fixturePath, 'errors.go'), config).then(diagnostics => {
			let sortedDiagnostics = diagnostics.sort((a, b) => a.line - b.line);
			for (let i in expected) {
				assert.equal(sortedDiagnostics[i].line, expected[i].line);
				assert.equal(sortedDiagnostics[i].severity, expected[i].severity);
				assert.equal(sortedDiagnostics[i].msg, expected[i].msg);
			}
			assert.equal(sortedDiagnostics.length, expected.length, `too many errors ${JSON.stringify(sortedDiagnostics)}`);
		}).then(() => done(), done);
	});

	test('Gometalinter error checking', (done) => {
		let config = vscode.workspace.getConfiguration('go');
		config['lintTool'] = 'gometalinter';
		let expected = [
			{ line: 7, severity: 'warning', msg: 'Print2 is unused (deadcode)' },
			{ line: 11, severity: 'warning', msg: 'error return value not checked (undeclared name: prin) (errcheck)' },
			{ line: 7, severity: 'warning', msg: 'exported function Print2 should have comment or be unexported (golint)' },
			{ line: 10, severity: 'warning', msg: 'main2 is unused (deadcode)' },
			{ line: 11, severity: 'warning', msg: 'undeclared name: prin (aligncheck)' },
			{ line: 11, severity: 'warning', msg: 'undeclared name: prin (gotype)' },
			{ line: 11, severity: 'warning', msg: 'undeclared name: prin (interfacer)' },
			{ line: 11, severity: 'warning', msg: 'undeclared name: prin (unconvert)' },
			{ line: 11, severity: 'error', msg: 'undefined: prin' },
			{ line: 11, severity: 'warning', msg: 'unused global variable undeclared name: prin (varcheck)' },
			{ line: 11, severity: 'warning', msg: 'unused struct field undeclared name: prin (structcheck)' },
		];
		check(path.join(fixturePath, 'errors.go'), config).then(diagnostics => {
			let sortedDiagnostics = diagnostics.sort((a, b) => {
				if ( a.msg < b.msg )
					return -1;
				if ( a.msg > b.msg )
					return 1;
				return 0;
			});
			for (let i in expected) {
				assert.equal(sortedDiagnostics[i].line, expected[i].line, `Failed to match expected error #${i}: ${JSON.stringify(sortedDiagnostics)}`);
				assert.equal(sortedDiagnostics[i].severity, expected[i].severity, `Failed to match expected error #${i}: ${JSON.stringify(sortedDiagnostics)}`);
				assert.equal(sortedDiagnostics[i].msg, expected[i].msg, `Failed to match expected error #${i}: ${JSON.stringify(sortedDiagnostics)}`);
			}
			assert.equal(sortedDiagnostics.length, expected.length, `too many errors ${JSON.stringify(sortedDiagnostics)}`);
		}).then(() => done(), done);
	});


	test('Test util.parseDiffOutput_using_diff_parse', (done) => {
		let file1path = path.join(fixtureSourcePath, 'diffTestData', 'file1.go');
		let file2path = path.join(fixtureSourcePath, 'diffTestData', 'file2.go');
		let file1uri = vscode.Uri.file(file1path);
		let file2contents = fs.readFileSync(file2path, 'utf8');

		return new Promise((resolve, reject) => {

			cp.exec(`diff -u ${file1path} ${file2path}`, (err, stdout, stderr) => {
				let filePatches = parseDiffOutput_using_diff_parse(stdout);

				if (!filePatches && filePatches.length !== 1) {
					assert.fail(null, null, 'Failed to get patches for the test file');
					reject();
				}

				if (!filePatches[0].fileName) {
					assert.fail(null, null, 'Failed to parse the file path from the diff output');
					reject();
				}

				if (!filePatches[0].edits) {
					assert.fail(null, null, 'Failed to parse edits from the diff output');
					reject();
				}

				vscode.workspace.openTextDocument(file1uri).then((textDocument) => {
					return vscode.window.showTextDocument(textDocument).then(editor => {
						return editor.edit((editBuilder) => {
							filePatches[0].edits.forEach(edit => {
								edit.applyUsingTextEditorEdit(editBuilder);
							});
						}).then(() => {
							assert.equal(editor.document.getText(), file2contents);
						});
					});
				}).then(() => {
					resolve();
				});
			});
		}).then(() => {
			vscode.commands.executeCommand('workbench.action.files.revert');
			done();
		}, done);

	});

	test('Test util.parseDiffOutput', (done) => {
		let file1path = path.join(fixtureSourcePath, 'diffTestData', 'file1.go');
		let file2path = path.join(fixtureSourcePath, 'diffTestData', 'file2.go');
		let file1uri = vscode.Uri.file(file1path);
		let file1contents = fs.readFileSync(file1path, 'utf8').split('\r\n').join('\n');
		let file2contents = fs.readFileSync(file2path, 'utf8').split('\r\n').join('\n');
		let unifiedDiffs: jsDiff.IUniDiff[] = [jsDiff.structuredPatch(file1path, file2path, file1contents, file2contents, '', '')];
		let filePatches = parseDiffOutput(unifiedDiffs);

		if (!filePatches && filePatches.length !== 1) {
			assert.fail(null, null, 'Failed to get patches for the test file');
			done();
		}

		if (!filePatches[0].fileName) {
			assert.fail(null, null, 'Failed to parse the file path from the diff output');
			done();
		}

		if (!filePatches[0].edits) {
			assert.fail(null, null, 'Failed to parse edits from the diff output');
			done();
		}

		vscode.workspace.openTextDocument(file1uri).then((textDocument) => {
			return vscode.window.showTextDocument(textDocument).then(editor => {
				return editor.edit((editBuilder) => {
					filePatches[0].edits.forEach(edit => {
						edit.applyUsingTextEditorEdit(editBuilder);
					});
				}).then(() => {
					let updatedText = editor.document.getText().split('\r\n').join('\n');
					assert.equal(updatedText, file2contents);
				});
			});
		}).then(() => {
			vscode.commands.executeCommand('workbench.action.files.revert');
			done();
		}, done);
	});

});
