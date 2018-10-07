import { getBinPath, getGoVersion, sendTelemetryEvent, getToolsEnvVars } from './util';
import path = require('path');
import cp = require('child_process');
import vscode = require('vscode');
import { getFromGlobalState, updateGlobalState } from './stateUtils';
import { installTools } from './goInstallTools';

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
const packageModCache = new Map<string, boolean>();

export function isModSupported(fileuri: vscode.Uri): Promise<boolean> {
	return getGoVersion().then(value => {
		if (value && (value.major !== 1 || value.minor < 11)) {
			return false;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileuri);
		if (workspaceFolder && workspaceModCache.get(workspaceFolder.uri.fsPath)) {
			return true;
		}
		const pkgPath = path.dirname(fileuri.fsPath);
		if (packageModCache.get(pkgPath)) {
			if (workspaceFolder && pkgPath === workspaceFolder.uri.fsPath) {
				workspaceModCache.set(workspaceFolder.uri.fsPath, true);
				logModuleUsage(true);
			} else {
				logModuleUsage(false);
			}
			return true;
		}
		return containsModFile(pkgPath).then(result => {
			packageModCache.set(pkgPath, result);
			if (result) {
				const goConfig = vscode.workspace.getConfiguration('go', fileuri);
				if (goConfig['inferGopath'] === true) {
					goConfig.update('inferGopath', false, vscode.ConfigurationTarget.WorkspaceFolder);
					alertDisablingInferGopath();
				}
			}
			return result;
		});
	});
}

export function updateWorkspaceModCache() {
	if (!vscode.workspace.workspaceFolders) {
		return;
	}
	let inferGopathUpdated = false;
	const promises = vscode.workspace.workspaceFolders.map(folder => {
		return containsModFile(folder.uri.fragment).then(result => {
			workspaceModCache.set(folder.uri.fsPath, result);
			if (result) {
				logModuleUsage(true);
				const goConfig = vscode.workspace.getConfiguration('go', folder.uri);
				if (goConfig['inferGopath'] === true) {
					return goConfig.update('inferGopath', false, vscode.ConfigurationTarget.WorkspaceFolder)
						.then(() => inferGopathUpdated = true);
				}
			}
		});
	});
	Promise.all(promises).then(() => {
		if (inferGopathUpdated) {
			alertDisablingInferGopath();
		}
	});
}

function alertDisablingInferGopath() {
	vscode.window.showInformationMessage('The "inferGopath" setting is disabled for this workspace because Go modules are being used.');
}

function logModuleUsage(atroot: boolean) {
	/* __GDPR__
		"modules" : {
			"atroot" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
		}
	*/
	sendTelemetryEvent('modules', {
		atroot: atroot ? 'true' : 'false'
	});
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
	vscode.window.showInformationMessage(
		promptMsg,
		'Update',
		'Later',
		`Don't show again`)
		.then(selected => {
			switch (selected) {
				case 'Update':
					installTools([tool]);
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
}

const folderToPackageMapping: { [key: string]: string } = {};
export function getCurrentPackage(cwd: string): Promise<string> {
	if (folderToPackageMapping[cwd]) {
		return Promise.resolve(folderToPackageMapping[cwd]);
	}

	let goRuntimePath = getBinPath('go');

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}
	return new Promise<string>(resolve => {
		let childProcess = cp.spawn(goRuntimePath, ['list'], { cwd, env: getToolsEnvVars() });
		let chunks = [];
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