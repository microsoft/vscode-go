import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getGoRuntimePath, getCurrentGoWorkspaceFromGOPATH } from './goPath';
import { isVendorSupported, getCurrentGoPath, getToolsEnvVars, getGoVersion, getBinPath, SemVersion } from './util';


/**
 * Runs go list all
 * @returns Map<string, string> mapping between package import path and package name
 */
export function goListAll(): Promise<Map<string, string>> {
	let goRuntimePath = getGoRuntimePath();

	// TODO prompt for missing tools, attach cmd.on('error')
	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}

	return new Promise<Map<string, string>>((resolve, reject) => {
		const cmd = cp.spawn(getBinPath('gopkgs'), ['-short=false'], { env: getToolsEnvVars() });
		const chunks = [];
		cmd.stdout.on('data', (d) => {
			chunks.push(d);
		});

		cmd.on('close', (status) => {
			// TODO do we need to cache?
			let pkgs = new Map<string, string>();
			chunks.join('').split('\n').forEach((pkgPath) => {
				if (!pkgPath) return;
				const lastIndex = pkgPath.lastIndexOf('/');
				let pkgName = lastIndex > -1 ? pkgPath.substr(lastIndex + 1) : pkgPath;
				pkgs.set(pkgPath, pkgName);
			});
			return resolve(pkgs);
		});
	});
}

/**
 * Returns mapping of import path and package name for packages that can be imported
 * @param filePath. Used to determine the right relative path for vendor pkgs
 * @returns Map<string, string> mapping between package import path and package name
 */
export function getImportablePackages(filePath: string): Promise<Map<string, string>> {

	return Promise.all([isVendorSupported(), goListAll()]).then(values => {
		let isVendorSupported = values[0];
		let pkgs = values[1];
		let currentFileDirPath = path.dirname(filePath);
		let currentWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), currentFileDirPath);
		let pkgMap = new Map<string, string>();

		pkgs.forEach((pkgName, pkgPath) => {
			if (pkgName === 'main') {
				return;
			}
			if (!isVendorSupported || !currentWorkspace) {
				pkgMap.set(pkgPath, pkgName);
				return;
			}
			let relativePkgPath = getRelativePackagePath(currentFileDirPath, currentWorkspace, pkgPath);
			if (relativePkgPath) {
				pkgMap.set(relativePkgPath, pkgName);
			}
		});
		return pkgMap;
	});

}

/**
 * If given pkgPath is not vendor pkg, then the same pkgPath is returned
 * Else, the import path for the vendor pkg relative to given filePath is returned.
 */
export function getRelativePackagePath(currentFileDirPath: string, currentWorkspace: string, pkgPath: string): string {
	let magicVendorString = '/vendor/';
	let vendorIndex = pkgPath.indexOf(magicVendorString);
	if (vendorIndex === -1) {
		magicVendorString = 'vendor/';
		if (pkgPath.startsWith(magicVendorString)) {
			vendorIndex = 0;
		}
	}
	// Check if current file and the vendor pkg belong to the same root project
	// If yes, then vendor pkg can be replaced with its relative path to the "vendor" folder
	// If not, then the vendor pkg should not be allowed to be imported.
	if (vendorIndex > -1) {
		let rootProjectForVendorPkg = path.join(currentWorkspace, pkgPath.substr(0, vendorIndex));
		let relativePathForVendorPkg = pkgPath.substring(vendorIndex + magicVendorString.length);

		if (relativePathForVendorPkg && currentFileDirPath.startsWith(rootProjectForVendorPkg)) {
			return relativePathForVendorPkg;
		}
		return '';
	}

	return pkgPath;
}

/**
 * Returns import paths for all packages under given folder (vendor will be excluded)
 */
export function getPackages(folderPath: string): Promise<string[]> {
	let goRuntimePath = getGoRuntimePath();

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}
	return new Promise<string[]>((resolve, reject) => {
		let childProcess = cp.spawn(goRuntimePath, ['list', './...'], { cwd: folderPath, env: getToolsEnvVars() });
		let chunks = [];
		childProcess.stdout.on('data', (stdout) => {
			chunks.push(stdout);
		});

		childProcess.on('close', (status) => {
			let pkgs = chunks.join('').toString().split('\n');
			getGoVersion().then((ver: SemVersion) => {
				if (ver && (ver.major > 1 || (ver.major === 1 && ver.minor >= 9))) {
					resolve(pkgs);
				} else {
					resolve(pkgs.filter(pkgPath => pkgPath && !pkgPath.includes('/vendor/')));
				}
			});
		});
	});
}

