import vscode = require('vscode');
import { stat } from 'fs';
import { execFile } from 'child_process';
import { outputChannel } from './goStatus';
import { getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';

const TOOL_CMD_NAME = 'goplay';

type flags = { [key: string]: Boolean };

export const playgroundCommand = () => {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}
	const config: flags = vscode.workspace.getConfiguration('go', editor.document.uri).get('playground');

	const selection = editor.selection;
	const code = selection.isEmpty
		? editor.document.getText()
		: editor.document.getText(selection);

	outputChannel.clear();
	outputChannel.show();
	outputChannel.appendLine('Upload to the Go Playground in progress...\n');

	const binaryLocation = getBinPath(TOOL_CMD_NAME);
	stat(binaryLocation, (err, stats) => {
		if (err || !stats.isFile()) {
			promptForMissingTool(TOOL_CMD_NAME);
			return;
		}
		const cliArgs = Object.keys(config).map(key => `-${key}=${config[key]}`);
		execFile(binaryLocation, [...cliArgs, '-'], (err, stdout, stderr) => {
			if (err) {
				vscode.window.showErrorMessage(`${TOOL_CMD_NAME}: ${stdout || stderr || err.message}`);
				return;
			}
			outputChannel.append(
`Output from the Go Playground:
${stdout || stderr}
Finished running tool: ${binaryLocation} ${cliArgs.join(' ')} -\n`
			);
		}).stdin.end(code);
	});
};
