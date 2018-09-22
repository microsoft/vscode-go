import { getBinPath, getToolsEnvVars, getGoVersion } from "./util";
import path = require('path');
import cp = require('child_process');
import vscode = require('vscode');

function containsModFile(folderPath: string): Promise<boolean> {
	let goExecutable = getBinPath('go');
	if (!goExecutable) {
		return Promise.reject(new Error('Cannot find "go" binary. Update PATH or GOROOT appropriately.'));
	}
	return new Promise(resolve => {
		cp.execFile(goExecutable, ['env', 'GOMOD'], { cwd: folderPath }, (err, stdout) => {
			if (err) {
				console.warn(`Error when running go env GOMOD: ${err}`);
				return resolve(false);
			}
			let [goMod] = stdout.split('\n');
			resolve(!!goMod);
		});
	});
}
const workspaceModCache = new Map<string, boolean>();
const packageModCache = new Map<string, string>();

export function isModSupported(fileuri: vscode.Uri): Promise<boolean> {
	return getGoVersion().then(value => {
		if (value.major !== 1 || value.minor < 11) {
			return false;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileuri);
		if (workspaceFolder && workspaceModCache.get(workspaceFolder.uri.fsPath)) {
			return true;
		}
		const pkgPath = path.dirname(fileuri.fsPath);
		if (packageModCache.get(pkgPath)) {
			return true;
		}
		return containsModFile(pkgPath).then(result => {
			workspaceModCache.set(pkgPath, result);
			return result;
		});
	});
}

export function updateWorkspaceModCache() {
	if (!vscode.workspace.workspaceFolders) {
		return;
	}
	vscode.workspace.workspaceFolders.forEach(folder => {
		containsModFile(folder.uri.fragment).then(result => {
			workspaceModCache.set(folder.uri.fsPath, result);
		});
	})
}

export function getModulePackages(workDir: string): Promise<Map<string, string>> {
	let goRuntimePath = getBinPath('go');

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}
	return new Promise<Map<string, string>>((resolve, reject) => {
		let childProcess = cp.spawn(goRuntimePath, ['list', '-f', '{{.Name}};{{.ImportPath}}', 'all'], {
			cwd: workDir,
			env: getToolsEnvVars()
		});
		let chunks = [];
		childProcess.stdout.on('data', (stdout) => {
			chunks.push(stdout);
		});

		childProcess.on('close', (status) => {
			let pkgs = new Map<string, string>();
			let output = chunks.join('').toString();

			output.split('\n').forEach((pkgDetail) => {
				if (!pkgDetail || !pkgDetail.trim() || pkgDetail.indexOf(';') === -1) return;
				let [pkgName, pkgPath] = pkgDetail.trim().split(';');
				pkgs.set(pkgPath, pkgName);
			});

			resolve(pkgs);
		});
	});
}