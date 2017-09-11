import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getGoRuntimePath, getCurrentGoWorkspaceFromGOPATH } from './goPath';
import { isVendorSupported, getCurrentGoPath, getToolsEnvVars, getGoVersion, getBinPath, SemVersion } from './util';
import { promptForMissingTool } from './goInstallTools';

const missingToolMsg = 'Missing tool: ';

let allPkgsCache: Map<string, string>
let allPkgsLastHit: number;

function getAllPackagesNoCache(): Promise<Map<string, string>> {
	return new Promise<Map<string, string>>((resolve, reject) => {
		const cmd = cp.spawn(getBinPath('gopkgs'), ['-format', '{{.Name}};{{.ImportPath}}'], { env: getToolsEnvVars(), stdio: ['pipe', 'pipe', 'ignore'] });
		const chunks = [];
		let err: any;
		cmd.stdout.on('data', d => chunks.push(d));
		cmd.on('error', e => err = e);
		cmd.on('close', () => {
			let pkgs = new Map<string, string>();
			if (err && err.code === 'ENOENT') {
				return reject(missingToolMsg + 'gopkgs');
			}

			if (err) return resolve(pkgs);

			chunks.join('').split('\n').forEach((pkgDetail) => {
				if (!pkgDetail || !pkgDetail.trim() || pkgDetail.indexOf(';') === -1) return;
				let [pkgName, pkgPath] = pkgDetail.trim().split(';');
				pkgs.set(pkgPath, pkgName);
			});
			return resolve(pkgs);
		});
	});
}

/**
 * Runs gopkgs
 * @returns Map<string, string> mapping between package import path and package name
 */
export function getAllPackages(): Promise<Map<string, string>> {
	let useCache = allPkgsCache && allPkgsLastHit && (new Date().getTime() - allPkgsLastHit) < 5000;
	if (useCache) {
		allPkgsLastHit = new Date().getTime();
		return Promise.resolve(allPkgsCache);
	}

	return getAllPackagesNoCache().then((pkgs) => {
		allPkgsLastHit = new Date().getTime();
		return allPkgsCache = pkgs;
	});
}

/**
 * Returns mapping of import path and package name for packages that can be imported
 * @param filePath. Used to determine the right relative path for vendor pkgs
 * @returns Map<string, string> mapping between package import path and package name
 */
export function getImportablePackages(filePath: string): Promise<Map<string, string>> {

	return Promise.all([isVendorSupported(), getAllPackages()]).then(values => {
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
export function getNonVendorPackages(folderPath: string): Promise<string[]> {
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

