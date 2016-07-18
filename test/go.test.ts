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
		let testCases: [vscode.Position, string][] = [
			// [new vscode.Position(3,3), '/usr/local/go/src/fmt'],
			[new vscode.Position(9, 6), 'main func()'],
			[new vscode.Position(7, 2), 'import (fmt "fmt")'],
			[new vscode.Position(7, 6), 'Println func(a ...interface{}) (n int, err error)'],
			[new vscode.Position(10, 3), 'print func(txt string)']
		];
		let uri = vscode.Uri.file(path.join(fixturePath, 'test.go'));
		vscode.workspace.openTextDocument(uri).then((textDocument) => {
			let promises = testCases.map(([position, expected]) =>
				provider.provideHover(textDocument, position, null).then(res => {
					assert.equal(res.contents.length, 1);
					assert.equal(expected, (<{ language: string; value: string }>res.contents[0]).value);
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
});
