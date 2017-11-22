import vscode = require('vscode');
import * as path from 'path';
import { execFile } from 'child_process';
import { outputChannel } from './goStatus';
import { getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';

const TOOL_CMD_NAME = 'goplay';

export const playgroundCommand = () => {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active.');
		return;
	}

	const binaryLocation = getBinPath(TOOL_CMD_NAME);
	if (!path.isAbsolute(binaryLocation)) {
		return promptForMissingTool(TOOL_CMD_NAME);
	}

	outputChannel.clear();
	outputChannel.show();
	outputChannel.appendLine('Upload to the Go Playground in progress...\n');

	const selection = editor.selection;
	const code = selection.isEmpty
		? editor.document.getText()
		: editor.document.getText(selection);
	goPlay(code, vscode.workspace.getConfiguration('go', editor.document.uri).get('playground')).then(result => {
		outputChannel.append(result);
	}, (e: string) => {
		if (e) {
			outputChannel.append(e);
		}
	});
};

export function goPlay(code: string, goConfig: vscode.WorkspaceConfiguration): Thenable<string> {
	const cliArgs = Object.keys(goConfig).map(key => `-${key}=${goConfig[key]}`);
	const binaryLocation = getBinPath(TOOL_CMD_NAME);

	return new Promise<string>((resolve, reject) => {
		execFile(binaryLocation, [...cliArgs, '-'], (err, stdout, stderr) => {
			if (err && (<any>err).code === 'ENOENT') {
				promptForMissingTool(TOOL_CMD_NAME);
				return reject();
			}
			if (err) {
				return reject(`Upload to the Go Playground failed.\n${stdout || stderr || err.message}`);
			}
			return resolve(
				`Output from the Go Playground:
${stdout || stderr}
Finished running tool: ${binaryLocation} ${cliArgs.join(' ')} -\n`
			);
		}).stdin.end(code);
	});
}
