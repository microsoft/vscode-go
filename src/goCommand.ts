import util = require('util');
import cp = require('child_process');
import { getBinPath } from "./util";

const execFile = util.promisify(cp.execFile);

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
		return null;
	}

	let args: string[] = [cmd];
	args = args.concat(flags);
	args.push(path);

	let stdout: string;
	let stderr: string;
	let err: Error;

	try {
		let result = await execFile(goRuntimePath, args, opts);
		stdout = result.stdout.toString();
		stderr = result.stderr.toString();
	} catch (e) {
		err = e;
	}
	return { stdout: stdout, stderr: stderr, err: err };
}
