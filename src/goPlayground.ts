import vscode = require('vscode');
import { execFile } from 'child_process';
import { outputChannel } from './goStatus';
import { getBinPath } from './util';
import { promptForMissingTool } from './goInstallTools';

const TOOL_CMD_NAME = 'goplay';
const BINARY_LOCATION = getBinPath(TOOL_CMD_NAME);

// isENOENT checks if the given error results from a missing tool installation
export const isENOENT = (err: Error): Boolean => (
	!!err && (<any>err).code === 'ENOENT'
);

// flags describes the configuration toggles for the command
type flags = { [key: string]: Boolean };

// stringifyFlags serializes a flags type into an array of CLI flags
export const stringifyFlags = (f: flags): string[] => (
	Object.keys(f).map((key) => `-${key}=${f[key]}`)
);

// uploader is the interface expected by `createCommandWith`
type uploader = (code: string, flags: flags) => Promise<string>;

// createCommandWith retrieves the go.playground configuration and passes
// it to the given `uploader`, together with the current editor selection
// (or the full content of the editor window if the selection is empty)
export const createCommandWith = (uploadFn: uploader) => () => {
	const editor = vscode.window.activeTextEditor;
	const config: flags = vscode.workspace.getConfiguration('go', editor.document.uri).get('playground');

	const selection = editor.selection;
	const code = selection.isEmpty
		? editor.document.getText()
		: editor.document.getText(selection);

	uploadFn(code, config)
		.then((stdout) => {
			outputChannel.append(`${TOOL_CMD_NAME}:\n${stdout}\n`);
			outputChannel.appendLine(
				`Finished running tool: ${BINARY_LOCATION} ${stringifyFlags(config).join(' ')} -`
			);
		})
		.catch((err: Error) => {
			if (isENOENT(err)) {
				promptForMissingTool(TOOL_CMD_NAME);
			} else {
				vscode.window.showErrorMessage(
					`${TOOL_CMD_NAME} returned error: ${err.message}`
				);
			}
		});
};

// uploadUsingTool implements `uploader` using command goplay for
// uploading the given code to the Go Playground
export const uploadUsingTool = (code: string, config: flags) => {
	return new Promise<string>((resolve, reject) => {
		execFile(BINARY_LOCATION, [...stringifyFlags(config), '-'], (err, stdout, stderr) => {
			if (isENOENT(err)) {
				return reject(err);
			}
			if (err) {
				return reject(new Error(`${stdout || stderr || err.message}`));
			}
			resolve(stdout);
		}).stdin.end(code);
	});
};

// the default export is the function that will be registered as the handler
// for the go.playground extension command in goMain.ts
export default createCommandWith(uploadUsingTool);
