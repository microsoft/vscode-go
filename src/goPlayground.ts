import vscode = require('vscode');
import { execFile } from 'child_process';
import { outputChannel } from './goStatus';
import { getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';

const TOOL_CMD_NAME = 'goplay';
const BINARY_LOCATION = getBinPath(TOOL_CMD_NAME);

export const playgroundCommand = () => {
	const config = vscode.workspace.getConfiguration('go', vscode.window.activeTextEditor.document.uri).get('playground');
	const flags = Object.keys(config).map(key => `-${key}=${config[key]}`);
	uploadAndRun(flags)
		.then((stdout) => {
			outputChannel.append(`${TOOL_CMD_NAME}:\n${stdout}\n`);
			outputChannel.appendLine(
				`Finished running tool: ${BINARY_LOCATION} ${flags.join(' ')} -\n`
			);
		})
		.catch((err: Error) => {
			if ((<any>err).code === 'ENOENT') {
				promptForMissingTool(TOOL_CMD_NAME);
			} else {
				vscode.window.showErrorMessage(
					`${TOOL_CMD_NAME} returned error: ${err.message}`
				);
			}
		});

};

export const uploadAndRun = (flags: string[]) => {
	return new Promise<string>((resolve, reject) => {
		const cp = execFile(BINARY_LOCATION, [...flags, '-'], (err, stdout, stderr) => {
			if (err && (<any>err).code === 'ENOENT') {
				return reject(err);
			}
			if (err) {
				return reject(new Error(`${stdout || stderr || err.message}`));
			}
			resolve(stdout);
		});

		const editor = vscode.window.activeTextEditor;
		const selection = editor.selection;
		const contents = selection.isEmpty
			? editor.document.getText()
			: editor.document.getText(selection);

		cp.stdin.end(contents);
	});
};
