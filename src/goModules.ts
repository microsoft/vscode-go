import { getBinPath, getGoVersion, getToolsEnvVars, sendTelemetryEvent, getModuleCache } from './util';
import path = require('path');
import cp = require('child_process');
import vscode = require('vscode');
import { getFromGlobalState, updateGlobalState } from './stateUtils';
import { installTools } from './goInstallTools';
import { fixDriveCasingInWindows } from './goPath';

function runGoModEnv(folderPath: string): Promise<string> {
	const goExecutable = getBinPath('go');
	if (!goExecutable) {
		return Promise.reject(new Error('Cannot find "go" binary. Update PATH or GOROOT appropriately.'));
	}
	return new Promise(resolve => {
		cp.execFile(goExecutable, ['env', 'GOMOD'], { cwd: folderPath, env: getToolsEnvVars() }, (err, stdout) => {
			if (err) {
				console.warn(`Error when running go env GOMOD: ${err}`);
				return resolve();
			}
			const [goMod] = stdout.split('\n');
			resolve(goMod);
		});
	});
}

export function isModSupported(fileuri: vscode.Uri): Promise<boolean> {
	return getModFolderPath(fileuri).then(modPath => !!modPath);
}

const packageModCache = new Map<string, string>();
export async function getModFolderPath(fileuri: vscode.Uri): Promise<string> {
	const pkgPath = path.dirname(fileuri.fsPath);
	if (packageModCache.has(pkgPath)) {
		return packageModCache.get(pkgPath);
	}

	// We never would be using the path under module cache for anything
	// So, dont bother finding where exactly is the go.mod file
	const moduleCache = getModuleCache();
	if (fixDriveCasingInWindows(fileuri.fsPath).startsWith(moduleCache)) {
		return moduleCache;
	}
	const goVersion = await getGoVersion();
	if (goVersion && (goVersion.major !== 1 || goVersion.minor < 11)) {
		return;
	}

	let goModEnvResult = await runGoModEnv(pkgPath);
	if (goModEnvResult) {
		logModuleUsage();
		goModEnvResult = path.dirname(goModEnvResult);
		const goConfig = vscode.workspace.getConfiguration('go', fileuri);
		let promptFormatTool = goConfig['formatTool'] === 'goreturns';

		if (goConfig['inferGopath'] === true) {
			goConfig.update('inferGopath', false, vscode.ConfigurationTarget.WorkspaceFolder);
			vscode.window.showInformationMessage('The "inferGopath" setting is disabled for this workspace because Go modules are being used.');
		}
		if (goConfig['useLanguageServer'] === false) {
			const promptMsg = 'To get better performance during code completion, please update to use the language server from Google';
			const choseToUpdateLS = await promptToUpdateToolForModules('gopls', promptMsg);
			promptFormatTool = promptFormatTool && !choseToUpdateLS;
		} else if (promptFormatTool) {
			const languageServerExperimentalFeatures: any = goConfig.get('languageServerExperimentalFeatures');
			promptFormatTool = languageServerExperimentalFeatures['format'] === false;
		}

		if (promptFormatTool) {
			goConfig.update('formatTool', 'goimports', vscode.ConfigurationTarget.WorkspaceFolder);
			vscode.window.showInformationMessage('`goreturns` doesnt support auto-importing missing imports when using Go modules yet. So updating the "formatTool" setting to `goimports` for this workspace.');
		}
	}
	packageModCache.set(pkgPath, goModEnvResult);
	return goModEnvResult;
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
export async function promptToUpdateToolForModules(tool: string, promptMsg: string): Promise<boolean> {
	if (promptedToolsForCurrentSession.has(tool)) {
		return false;
	}
	const promptedToolsForModules = getFromGlobalState('promptedToolsForModules', {});
	if (promptedToolsForModules[tool]) {
		return false;
	}
	const goVersion = await getGoVersion();
	const selected = await vscode.window.showInformationMessage(
		promptMsg,
		'Update',
		'Later',
		`Don't show again`);
	let choseToUpdate = false;
	switch (selected) {
		case 'Update':
			choseToUpdate = true;
			installTools([tool], goVersion)
				.then(() => {
					if (tool === 'gopls') {
						const goConfig = vscode.workspace.getConfiguration('go');
						if (goConfig.get('useLanguageServer') === false) {
							goConfig.update('useLanguageServer', true, vscode.ConfigurationTarget.Global);
						}
						if (goConfig.inspect('useLanguageServer').workspaceFolderValue === false) {
							goConfig.update('useLanguageServer', true, vscode.ConfigurationTarget.WorkspaceFolder);
						}
						vscode.window.showInformationMessage('Reload VS Code window to enable the use of Go language server');
					}
				});
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
	return choseToUpdate;
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

	const goRuntimePath = getBinPath('go');

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}
	return new Promise<string>(resolve => {
		const childProcess = cp.spawn(goRuntimePath, ['list'], { cwd, env: getToolsEnvVars() });
		const chunks: any[] = [];
		childProcess.stdout.on('data', (stdout) => {
			chunks.push(stdout);
		});

		childProcess.on('close', () => {
			// Ignore lines that are empty or those that have logs about updating the module cache
			const pkgs = chunks.join('').toString().split('\n').filter(line => line && line.indexOf(' ') === -1);
			if (pkgs.length !== 1) {
				resolve();
				return;
			}
			folderToPackageMapping[cwd] = pkgs[0];
			resolve(pkgs[0]);
		});
	});
}
