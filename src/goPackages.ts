import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getGoRuntimePath } from './goPath';
import { isVendorSupported, getCurrentGoWorkspaceFromGOPATH } from './util';

let allPkgs = new Map<string, string>();
let goListAllCompleted: boolean = false;

/**
 * Runs go list all
 * @returns Map<string, string> mapping between package import path and package name
 */
export function goListAll(): Promise<Map<string, string>> {
	let goRuntimePath = getGoRuntimePath();

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}

	if (goListAllCompleted) {
		return Promise.resolve(allPkgs);
	}
	return new Promise<Map<string, string>>((resolve, reject) => {
		const cmd = cp.spawn(goRuntimePath, ['list', '-f', '{{.Name}};{{.ImportPath}}', 'all']);
		cmd.stdout.on('data', (d) => {
			d.toString().split('\n').forEach(pkgDetail => {
				if (!pkgDetail || !pkgDetail.trim() || pkgDetail.indexOf(';') === -1) return;
				let [pkgName, pkgPath] = pkgDetail.trim().split(';');
				allPkgs.set(pkgPath, pkgName);
			});
		});

		cmd.on('close', (status) => {
			// this command usually exists with 1 because `go list` expists certain folders
			// to be packages but they can just be regular folders and therefore the cmd will
			// send those "failed imports" to stderr and exist with error 1.
			if (status > 1) {
				return reject();
			}

			goListAllCompleted = true;
			return resolve(allPkgs);
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
		let currentFileDirPath = path.dirname(filePath);
		let currentWorkspace = getCurrentGoWorkspaceFromGOPATH(currentFileDirPath);
		let pkgMap = new Map<string, string>();

		allPkgs.forEach((pkgName, pkgPath) => {
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
 * Returns import paths for all non vendor packages under given folder
 */
export function getNonVendorPackages(folderPath: string): Promise<string[]> {
	let goRuntimePath = getGoRuntimePath();

	if (!goRuntimePath) {
		vscode.window.showInformationMessage('Cannot find "go" binary. Update PATH or GOROOT appropriately');
		return Promise.resolve(null);
	}
	return new Promise<string[]>((resolve, reject) => {
		const childProcess = cp.spawn(goRuntimePath, ['list', './...'], { cwd: folderPath });
		let pkgs = [];
		childProcess.stdout.on('data', (stdout) => {
			pkgs = pkgs.concat(stdout.toString().split('\n').filter(pkgPath => pkgPath && pkgPath.indexOf('/vendor/') === -1));
		});

		childProcess.on('close', (status) => {
			return resolve(pkgs);
		});
	});
}

