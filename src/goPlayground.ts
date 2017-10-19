import vscode = require('vscode');
import { stat } from 'fs';
import { execFile } from 'child_process';
import { outputChannel } from './goStatus';
import { getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';

// flags describes the configuration toggles for the command
type flags = { [key: string]: Boolean };

// IPlaygroundUploader needs to be implemented by the uploader passed to createCommandWith
export interface IPlaygroundUploader {
	upload(code: string, config: flags): Promise<string>;
}

// createCommandWith retrieves the go.playground configuration and passes
// it to the given `uploader`, together with the current editor selection
// (or the full content of the editor window if the selection is empty)
export const createCommandWith = (uploader: IPlaygroundUploader) => (): Promise<any> => {
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

	return uploader.upload(code, config)
		.then(result => outputChannel.append(result))
		.catch(err =>  {
			if ((<any>err).missingTool) {
				promptForMissingTool(err.missingTool);
			} else {
				vscode.window.showErrorMessage(err.message);
			}
		});
};

// GoplayUploader implements `IPlaygroundUploader` using command goplay
export class GoplayUploader implements IPlaygroundUploader {
	private TOOL_CMD_NAME = 'goplay';
	static stringifyFlags(f: flags): string[] {
		return Object.keys(f).map(key => `-${key}=${f[key]}`);
	}
	upload(code: string, config: flags): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const binaryLocation = getBinPath(this.TOOL_CMD_NAME);
			stat(binaryLocation, (err, stats) => {
				if (err || !stats.isFile()) {
					err = err || new Error('Missing tool');
					(<any>err).missingTool = this.TOOL_CMD_NAME;
					reject(err);
					return;
				}
				execFile(binaryLocation, [...GoplayUploader.stringifyFlags(config), '-'], (err, stdout, stderr) => {
					if (err) {
						reject(new Error(`${this.TOOL_CMD_NAME}: ${stdout || stderr || err.message}`));
						return;
					}
					resolve(this.formatStdout(stdout || stderr, config));
				}).stdin.end(code);
			});
		});
	}
	private formatStdout(result: string, config: flags) {
		return `Output from the Go Playground:
${result}
Finished running tool: ${getBinPath(this.TOOL_CMD_NAME)} ${GoplayUploader.stringifyFlags(config).join(' ')} -\n`;
	}
}

// the default export is the function that will be registered as the handler
// for the go.playground extension command in goMain.ts
export default createCommandWith(new GoplayUploader());
