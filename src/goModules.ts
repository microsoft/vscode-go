import { getBinPath, getGoVersion, sendTelemetryEvent, getToolsEnvVars } from './util';
import path = require('path');
import cp = require('child_process');
import vscode = require('vscode');
import { getFromGlobalState, updateGlobalState } from './stateUtils';
import { installTools } from './goInstallTools';

const workspaceModCache = new Map<string, boolean>();
const folderModCache = new Map<string, string>();

export function isModSupported(fileuri: vscode.Uri): Promise<boolean> {
	return getModPath(fileuri).then(modPath => {
		return modPath !== '';
	});
}

export function getModPath(fileuri: vscode.Uri): Promise<string> {
	const folderPath = path.dirname(fileuri.fsPath);

	const hit = folderModCache.get(folderPath);
	if (hit !== undefined) {
		return Promise.resolve(hit);
	}

	for (let k of Array.from(workspaceModCache.keys())) {
		if (folderPath.startsWith(k)) {
			folderModCache.set(folderPath, k);
			return Promise.resolve(k);
		}
	}

	return getGoVersion().then(value => {
		if (value && (value.major !== 1 || value.minor < 11)) {
			folderModCache.set(folderPath, '');
			return '';
		}

		return new Promise<string>(resolve => {
			let goExecutable = getBinPath('go');
			if (!goExecutable) {
				return Promise.reject(new Error('Cannot find "go" binary. Update PATH or GOROOT appropriately.'));
			}
			cp.execFile(goExecutable, ['list', '-m', '-f', '{{.GoMod}}'], { cwd: folderPath, env: getToolsEnvVars() }, (err, stdout) => {
				if (err) {
					resolve('');
				}
				let [goMod] = stdout.split('\n');
				resolve(goMod);
			});
		}).then(result => {
			let modPath: string;
			if (result !== '') {
				const goConfig = vscode.workspace.getConfiguration('go', fileuri);
				if (goConfig['inferGopath'] === true) {
					goConfig.update('inferGopath', false, vscode.ConfigurationTarget.WorkspaceFolder);
					alertDisablingInferGopath();
				}
				logModuleUsage(true);
				modPath = path.dirname(result);
				workspaceModCache.set(modPath, true);
			} else {
				modPath = '';
			}

			folderModCache.set(folderPath, modPath);
			return modPath;
		});
	}).catch(() => {
		return '';
	});
}

export function updateWorkspaceModCache() {
	if (!vscode.workspace.workspaceFolders) {
		return;
	}
	const promises = vscode.workspace.workspaceFolders.map(folder => {
		return getModPath(folder.uri);
	});
	Promise.all(promises);
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