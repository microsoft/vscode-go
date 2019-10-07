import util = require('util');
import cp = require('child_process');
import { getBinPath } from './util';

export class GoCommandResult {
	stderr: string;
	stdout: string;
	err: Error;
}

export async function goGet(path: string, flags: string[], opts: any): Promise<GoCommandResult> {
	return goCommand('get', path, flags, opts);
}

export async function goBuild(path: string, flags: string[], opts: any): Promise<GoCommandResult> {
	return goCommand('build', path, flags, opts);
}

async function goCommand(cmd: string, path: string, flags: string[], opts: any): Promise<GoCommandResult> {
	const goRuntimePath = getBinPath('go');
	if (!goRuntimePath) {
		return new Promise<GoCommandResult>(resolve => {
			resolve({
				stdout: '',
				stderr: '',
				err: new Error('failed to determine path to `go` binary'),
			})
		});
	}

	const args = [cmd, ...flags, path];

	return new Promise<GoCommandResult>(resolve => {
		cp.execFile(goRuntimePath, args, opts, (err, stdout, stderr) => {
			resolve({
				stdout: stdout.toString(),
				stderr: stderr.toString(),
				err: err,
			});
		});
	});
}
