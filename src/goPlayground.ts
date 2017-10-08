import vscode = require('vscode');
import { execFile } from 'child_process';
import { outputChannel } from './goStatus';
import { getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';

// isENOENT checks if the given error results from a missing tool installation
export const isENOENT = (err: Error): Boolean => (
	!!err && (<any>err).code === 'ENOENT'
);

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
	const config: flags = vscode.workspace.getConfiguration('go', editor.document.uri).get('playground');

	const selection = editor.selection;
	const code = selection.isEmpty
		? editor.document.getText()
		: editor.document.getText(selection);

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
	private BINARY_LOCATION = getBinPath(this.TOOL_CMD_NAME);
	static stringifyFlags(f: flags): string[] {
		return Object.keys(f).map(key => `-${key}=${f[key]}`);
	}
	upload(code: string, config: flags): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			execFile(this.BINARY_LOCATION, [...GoplayUploader.stringifyFlags(config), '-'], (err, stdout, stderr) => {
				if (isENOENT(err)) {
					(<any>err).missingTool = this.TOOL_CMD_NAME;
					return reject(err);
				}
				if (err) {
					return reject(new Error(`${this.TOOL_CMD_NAME}: ${stdout || stderr || err.message}`));
				}
				resolve(this.formatStdout(stdout || stderr, config));
			}).stdin.end(code);
		});
	}
	private formatStdout(result: string, config: flags) {
		return `Output from the Go Playground:
${result}
Finished running tool: ${this.BINARY_LOCATION} ${GoplayUploader.stringifyFlags(config).join(' ')} -\n`;
	}
}

// the default export is the function that will be registered as the handler
// for the go.playground extension command in goMain.ts
export default createCommandWith(new GoplayUploader());
