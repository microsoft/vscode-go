import vscode = require('vscode');
import { execFile } from 'child_process';
import { outputChannel } from './goStatus';
import { getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';

const TOOL_CMD_NAME = 'goplay';
const BINARY_LOCATION = getBinPath(TOOL_CMD_NAME);

export const uploadAndRun = () => {
	const editor = vscode.window.activeTextEditor;

	const config = vscode.workspace.getConfiguration('go', editor.document.uri).get('playground');
	const flags = Object.keys(config).map(key => `-${key}=${config[key]}`);

	const cp = execFile(BINARY_LOCATION, [...flags, '-'], (err, stdout, stderr) => {
		if (err && (<any>err).code === 'ENOENT') {
			promptForMissingTool(TOOL_CMD_NAME);
			return;
		}
		if (err) {
			vscode.window.showErrorMessage(
				`${TOOL_CMD_NAME} returned error: ${stdout || stderr || err.message}`
			);
			return;
		}
		if (stdout) {
			outputChannel.append(`${TOOL_CMD_NAME}:\n${stdout}\n`);
		}
		outputChannel.appendLine(
			`Finished running tool: ${BINARY_LOCATION} ${flags.join(' ')} -\n\n`
		);
	});

	const selection = editor.selection;
	const contents = selection.isEmpty
		? editor.document.getText()
		: editor.document.getText(selection);

	cp.stdin.end(contents);
};
