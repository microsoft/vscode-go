import * as assert from 'assert';
import cp = require('child_process');
import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { updateGoPathGoRootFromConfig } from '../../src/goInstallTools';
import { extensionId } from '../../src/telemetry';
import { getCurrentGoPath } from '../../src/util';

// Env is a collection of test related variables
// that define the test environment such as vscode workspace.
class Env {

	// Currently gopls requires a workspace and does not work in a single-file mode.
	// Code in test environment does not support dynamically adding folders.
	// tslint:disable-next-line:max-line-length
	// https://github.com/microsoft/vscode/blob/890f62dfd9f3e70198931f788c5c332b3e8b7ad7/src/vs/workbench/services/workspaces/browser/abstractWorkspaceEditingService.ts#L281
	//
	// So, when we start the gopls tests, we start the test extension host with a
	// dummy workspace, ${projectDir}/test/gopls/testfixtures/src/workspace
	// (see test/runTest.ts and launch.json).
	// Then copy necessary files to the workspace using Env.reset() from the
	// fixturesRoot directory.
	public workspaceDir: string;
	public fixturesRoot: string;

	public extension: vscode.Extension<any>;

	constructor(projectDir: string) {
		if (!projectDir) {
			assert.fail('project directory cannot be determined');
		}
		this.workspaceDir = path.resolve(projectDir, 'test/gopls/testfixtures/src/workspace');
		this.fixturesRoot = path.resolve(projectDir, 'test/fixtures');
		this.extension = vscode.extensions.getExtension(extensionId);

		// Ensure the vscode extension host is configured as expected.
		const workspaceFolder = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath);
		if (this.workspaceDir !== workspaceFolder) {
			assert.fail(`specified workspaceDir: ${this.workspaceDir} does not match the workspace folder: ${workspaceFolder}`);
		}
	}

	public async setup() {
		const wscfg = vscode.workspace.getConfiguration('go');
		if (!wscfg.get('useLanguageServer')) {
			wscfg.update('useLanguageServer', true, vscode.ConfigurationTarget.Workspace);
		}

		await this.reset();
		await this.extension.activate();
		await sleep(2000);  // allow extension host + gopls to start.
	}

	public async reset(fixtureDirName?: string) {  // name of the fixtures subdirectory to use.
		try {
			// clean everything except the .gitignore file
			// needed to keep the empty directory in vcs.
			await fs.readdir(this.workspaceDir).then((files) => {
				return Promise.all(
					files.filter((filename) => filename !== '.gitignore').map((file) => {
						fs.remove(path.resolve(this.workspaceDir, file));
					}));
				});

			if (!fixtureDirName) {
				return;
			}
			const src = path.resolve(this.fixturesRoot, fixtureDirName);
			const dst = this.workspaceDir;
			await fs.copy(src, dst, { recursive: true });
		} catch (err) {
			assert.fail(err);
		}
	}

	// openDoc opens the file in the workspace with the given path (paths
	// are the path elements of a file).
	public async openDoc(...paths: string[]) {
		const uri = vscode.Uri.file(path.resolve(this.workspaceDir, ...paths));
		const doc = await vscode.workspace.openTextDocument(uri);
		return { uri, doc };
	}
}

async function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('Go Extension Tests With Gopls', function () {
	this.timeout(1000000);
	const projectDir = path.join(__dirname, '..', '..', '..');
	const env = new Env(projectDir);

	suiteSetup(async () => { await env.setup(); });
	suiteTeardown(async () => { await env.reset(); });

	test('HoverProvider', async () => {
		await env.reset('gogetdocTestData');
		const { uri, doc } = await env.openDoc('test.go');

		// TODO(hyangah): find a way to wait for the language server to complete processing.

		const testCases: [string, vscode.Position, string | null, string | null][] = [
			// [new vscode.Position(3,3), '/usr/local/go/src/fmt'],
			['keyword', new vscode.Position(0, 3), null, null], // keyword
			['inside a string', new vscode.Position(23, 14), null, null], // inside a string
			['just a }', new vscode.Position(20, 0), null, null], // just a }
			['inside a number', new vscode.Position(28, 16), null, null], // inside a number
			['func main()', new vscode.Position(22, 5), 'func main()', null],
			['import "math"', new vscode.Position(40, 23), 'package math', '`math` on'],
			['func Println()', new vscode.Position(19, 6), 'func fmt.Println(a ...interface{}) (n int, err error)', 'Println formats '],
			['func print()', new vscode.Position(23, 4), 'func print(txt string)', 'This is an unexported function ']
		];

		const promises = testCases.map(async ([name, position, expectedSignature, expectedDoc]) => {
			const hovers = await vscode.commands.executeCommand(
				'vscode.executeHoverProvider', uri, position) as vscode.Hover[];

			if (expectedSignature === null && expectedDoc === null) {
				assert.equal(hovers.length, 0, `check hovers over ${name} failed: unexpected non-empty hover message.`);
				return;
			}

			const hover = hovers[0];
			assert.equal(hover.contents.length, 1, `check hovers over ${name} failed: unexpected number of hover messages.`);
			const gotMessage = (<vscode.MarkdownString>hover.contents[0]).value;
			assert.ok(
				gotMessage.includes('```go\n' + expectedSignature + '\n```')
				&& (!expectedDoc || gotMessage.includes(expectedDoc)),
				`check hovers over ${name} failed: got ${gotMessage}`);
		});
		return Promise.all(promises);
	});
});
