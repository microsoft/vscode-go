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

var fixtureSrc =
	`package main

import ( 
	"fmt"
)
func print(txt string) {
	fmt.Println(txt)
}
func main() {
	print("Hello")
}`;

suite("Go Extension Tests", () => {
	let gopath = process.env['GOPATH'];
	let repoPath = path.join(gopath, 'src', '___testrepo');
	let fixturePath = path.join(repoPath, 'test', 'testfixture');
	let fixture = path.join(fixturePath, "test.go");

	suiteSetup(() => {
		assert.ok(gopath !== null, "GOPATH is not defined");
		fs.removeSync(repoPath);
		fs.mkdirsSync(fixturePath);
		fs.writeFileSync(fixture, fixtureSrc);
	});

	suiteTeardown(() => {
		fs.removeSync(repoPath);
	});

	test("Test Hover Provider", (done) => {
		let provider = new GoHoverProvider();
		let testCases: [vscode.Position, string][] = [
			//[new vscode.Position(3,3), '/usr/local/go/src/fmt'],
			[new vscode.Position(8, 6), 'main func()'],
			[new vscode.Position(6, 2), 'import (fmt "fmt")'],
			[new vscode.Position(6, 6), 'Println func(a ...interface{}) (n int, err error)'],
			[new vscode.Position(9, 3), 'print func(txt string)']
		];
		let uri = vscode.Uri.file(fixture);
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

	test("Test Completion", (done) => {
		let provider = new GoCompletionItemProvider();
		let testCases: [vscode.Position, string[]][] = [
			[new vscode.Position(1, 0), []],
			[new vscode.Position(4, 1), ['main', 'print', 'fmt']],
			[new vscode.Position(6, 4), ['fmt']],
			[new vscode.Position(7, 0), ['main', 'print', 'fmt', 'txt']]
		];
		let uri = vscode.Uri.file(fixture);
		vscode.workspace.openTextDocument(uri).then((textDocument) => {
			let promises = testCases.map(([position, expected]) =>
				provider.provideCompletionItems(textDocument, position, null).then(items => {
					let labels = items.map(x => x.label);
					for (let entry of expected) {
						if (labels.indexOf(entry) < 0) {
							assert.fail("", entry, "missing expected item in competion list");
						}
					}
				})
			);
			return Promise.all(promises);
		}, (err) => {
			assert.ok(false, `error in OpenTextDocument ${err}`);
		}).then(() => done(), done);
	});

	test("Test Signature Help", (done) => {
		let provider = new GoSignatureHelpProvider();
		let testCases: [vscode.Position, string][] = [
			[new vscode.Position(6, 13), "Println(a ...interface{}) (n int, err error)"],
			[new vscode.Position(9, 7), "print(txt string)"]
		];
		let uri = vscode.Uri.file(fixture);
		vscode.workspace.openTextDocument(uri).then((textDocument) => {
			let promises = testCases.map(([position, expected]) =>
				provider.provideSignatureHelp(textDocument, position, null).then(sigHelp => {
					assert.equal(sigHelp.signatures.length, 1, "unexpected number of overloads");
					assert.equal(sigHelp.signatures[0].label, expected)
				})
			);
			return Promise.all(promises);
		}, (err) => {
			assert.ok(false, `error in OpenTextDocument ${err}`);
		}).then(() => done(), done);
	});
});