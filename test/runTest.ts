import * as fs from 'fs-extra';
import * as path from 'path';
import { runTests } from 'vscode-test';
import { extensionId } from '../src/telemetry';

async function main() {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
	const extensionDevelopmentPath = path.resolve(__dirname, '../../');

	try {
		// The path to the extension test script
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './integration/index');

		// Download VS Code, unzip it and run the integration test
		await runTests({ extensionDevelopmentPath, extensionTestsPath });
	} catch (err) {
		console.error('Failed to run integration tests' + err);
		process.exit(1);
	}

	// Integration tests using gopls.
	try {
		// Currently gopls requires a workspace. Code in test environment does not support
		// dynamically adding folders.
		// tslint:disable-next-line:max-line-length
		// https://github.com/microsoft/vscode/blob/890f62dfd9f3e70198931f788c5c332b3e8b7ad7/src/vs/workbench/services/workspaces/browser/abstractWorkspaceEditingService.ts#L281
		// So, we start the test extension host with a dummy workspace (test/gopls/testfixtures/src/workspace)
		// and copy necessary files to the workspace.
		const ws = path.resolve(extensionDevelopmentPath, 'test/gopls/testfixtures/src/workspace');

		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath: path.resolve(__dirname, './gopls/index'),
			launchArgs: [
				'--disable-extensions',  // disable all other extensions
				ws  // dummy workspace to start with
			],
		});
	} catch (err) {
		console.error('Failed to run gopls tests' + err);
	}
}

main();
