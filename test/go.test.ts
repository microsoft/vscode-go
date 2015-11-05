
import * as assert from 'assert';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { GoHoverProvider } from '../src/goExtraInfo';

// setup:
//     Fixture path: $GOPATH/src/___testrepo/test/testfixture/test.go
//     Fixture file: test.go
// Contents:

var fixtureSrc =
	`package main
func main() {
	main()
}`;

suite("Go Extension Tests", () => {
	let gopath = process.env['GOPATH'];
	let repoPath = path.join(gopath, 'src', '___testrepo');
	let fixturePath = path.join(repoPath, 'test', 'testfixture');
	let fixture = path.join(fixturePath, "test.go");

	suiteSetup(() => {
		assert.ok(gopath !== null, "GOPATH is not defined");
		assert.ok(!fs.existsSync(repoPath), 'fixture path already exists');
		fs.mkdirsSync(fixturePath);
		fs.writeFileSync(fixture, fixtureSrc);
	});

	suiteTeardown(() => {
		fs.removeSync(repoPath);
	});

	test("Test Hover Provider", (done) => {
		let provider = new GoHoverProvider();
		let position = new vscode.Position(1, 6);

		let uri = vscode.Uri.file(fixture);
		vscode.workspace.openTextDocument(uri).then((textDocument) => {
            provider.provideHover(textDocument, position, null).then(value => {
                assert.equal(value.contents.length, 1);
				assert.equal('main func()', (<{ language: string; value: string }> value.contents[0]).value, 'hover text does not match');
				assert.deepEqual(new vscode.Range(1, 5, 1, 9), value.range);
				done();
			});
		}, (err) => {
			assert.ok(false, `error in OpenTextDocument ${err}`);
		});
	});
});