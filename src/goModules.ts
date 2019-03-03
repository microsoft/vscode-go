import { getBinPath, getGoVersion, getToolsEnvVars, sendTelemetryEvent, getModuleCache } from './util';
import path = require('path');
import cp = require('child_process');
import vscode = require('vscode');
import { getFromGlobalState, updateGlobalState } from './stateUtils';
import { installTools } from './goInstallTools';
import { fixDriveCasingInWindows } from './goPath';

function runGoModEnv(folderPath: string): Promise<string> {
	let goExecutable = getBinPath('go');
	if (!goExecutable) {
		return Promise.reject(new Error('Cannot find "go" binary. Update PATH or GOROOT appropriately.'));
	}
	return new Promise(resolve => {
		cp.execFile(goExecutable, ['env', 'GOMOD'], { cwd: folderPath, env: getToolsEnvVars() }, (err, stdout) => {
			if (err) {
				console.warn(`Error when running go env GOMOD: ${err}`);
				return resolve();
			}
			let [goMod] = stdout.split('\n');
			resolve(goMod);
		});
	});
}

export function isModSupported(fileuri: vscode.Uri): Promise<boolean> {
	return getModFolderPath(fileuri).then(modPath => !!modPath);
}

const packageModCache = new Map<string, string>();
export function getModFolderPath(fileuri: vscode.Uri): Promise<string> {
	const pkgPath = path.dirname(fileuri.fsPath);
	if (packageModCache.has(pkgPath)) {
		return Promise.resolve(packageModCache.get(pkgPath));
	}

	// We never would be using the path under module cache for anything
	// So, dont bother finding where exactly is the go.mod file
	const moduleCache = getModuleCache();
	if (fixDriveCasingInWindows(fileuri.fsPath).startsWith(moduleCache)) {
		return Promise.resolve(moduleCache);
	}

	return getGoVersion().then(value => {
		if (value && (value.major !== 1 || value.minor < 11)) {
			return;
		}

		return runGoModEnv(pkgPath).then(result => {
			if (result) {
				logModuleUsage();
				result = path.dirname(result);
				const goConfig = vscode.workspace.getConfiguration('go', fileuri);
				if (goConfig['inferGopath'] === true) {
					goConfig.update('inferGopath', false, vscode.ConfigurationTarget.WorkspaceFolder);
					vscode.window.showInformationMessage('The "inferGopath" setting is disabled for this workspace because Go modules are being used.');
				}
				if (goConfig['formatTool'] === 'goreturns') {
					goConfig.update('formatTool', 'goimports', vscode.ConfigurationTarget.WorkspaceFolder);
					vscode.window.showInformationMessage('`goreturns` doesnt support auto-importing missing imports when using Go modules yet. So updating the "formatTool" setting to `goimports` for this workspace.');
				}
			}
			packageModCache.set(pkgPath, result);
			return result;
		});
	});
}


let moduleUsageLogged = false;
function logModuleUsage() {
	if (moduleUsageLogged) {
		return;
	}
	moduleUsageLogged = true;
	/* __GDPR__
		"modules" : {}
	*/
	sendTelemetryEvent('modules');
}

const promptedToolsForCurrentSession = new Set<string>();
export function promptToUpdateToolForModules(tool: string, promptMsg: string) {
	if (promptedToolsForCurrentSession.has(tool)) {
		return;
	}
	const promptedToolsForModules = getFromGlobalState('promptedToolsForModules', {});
	if (promptedToolsForModules[tool]) {
		return;
	}
	getGoVersion().then(goVersion => {
		vscode.window.showInformationMessage(
			promptMsg,
			'Update',
			'Later',
			`Don't show again`)
			.then(selected => {
				switch (selected) {
					case 'Update':
						installTools([tool], goVersion);
						promptedToolsForModules[tool] = true;
						updateGlobalState('promptedToolsForModules', promptedToolsForModules);
						break;
					case `Don't show again`:
						promptedToolsForModules[tool] = true;
						updateGlobalState('promptedToolsForModules', promptedToolsForModules);
						break;
					case 'Later':
					default:
						promptedToolsForCurrentSession.add(tool);
						break;
				}
			});
	});
}

const folderToPackageMapping: { [key: string]: string } = {};
export function getCurrentPackage(cwd: string): Promise<string> {
	if (folderToPackageMapping[cwd]) {
		return Promise.resolve(folderToPackageMapping[cwd]);
	}

	const moduleCache = getModuleCache();
	if (cwd.startsWith(moduleCache)) {
		let importPath = cwd.substr(moduleCache.length + 1);
		const matches = /@v\d+(\.\d+)?(\.\d+)?/.exec(importPath);
		if (matches) {
			importPath = importPath.substr(0, matches.index);
		}

		folderToPackageMapping[cwd] = importPath;
		return Promise.resolve(importPath);
	}

	let goRuntimePath = getBinPath('go');

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}
	return new Promise<string>(resolve => {
		let childProcess = cp.spawn(goRuntimePath, ['list'], { cwd, env: getToolsEnvVars() });
		let chunks: any[] = [];
		childProcess.stdout.on('data', (stdout) => {
			chunks.push(stdout);
		});

		childProcess.on('close', () => {
			// Ignore lines that are empty or those that have logs about updating the module cache
			let pkgs = chunks.join('').toString().split('\n').filter(line => line && line.indexOf(' ') === -1);
			if (pkgs.length !== 1) {
				resolve();
				return;
			}
			folderToPackageMapping[cwd] = pkgs[0];
			resolve(pkgs[0]);
		});
	});
}
