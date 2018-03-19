import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getGoRuntimePath, getCurrentGoWorkspaceFromGOPATH, fixDriveCasingInWindows } from './goPath';
import { isVendorSupported, getCurrentGoPath, getToolsEnvVars, getGoVersion, getBinPath, SemVersion, sendTelemetryEvent } from './util';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';

type GopkgsDone = (res: Map<string, string>) => void;
let allPkgsCache: Map<string, string>;
let allPkgsLastHit: number;
let gopkgsRunning: boolean = false;
let gopkgsNotified: boolean = false;
let gopkgsSubscriptions: GopkgsDone[] = [];
let cacheTimeout: number = 5000;

function gopkgs(): Promise<Map<string, string>> {
	let t0 = Date.now();
	return new Promise<Map<string, string>>((resolve, reject) => {
		const cmd = cp.spawn(getBinPath('gopkgs'), ['-format', '{{.Name}};{{.ImportPath}}'], { env: getToolsEnvVars() });
		const chunks = [];
		const errchunks = [];
		let err: any;
		cmd.stdout.on('data', d => chunks.push(d));
		cmd.stderr.on('data', d => errchunks.push(d));
		cmd.on('error', e => err = e);
		cmd.on('close', () => {
			let pkgs = new Map<string, string>();
			if (err && err.code === 'ENOENT') {
				return promptForMissingTool('gopkgs');
			}

			if (err || errchunks.length > 0) return resolve(pkgs);

			const output = chunks.join('');
			if (output.indexOf(';') === -1) {
				// User might be using the old gopkgs tool, prompt to update
				promptForUpdatingTool('gopkgs');
				output.split('\n').forEach(pkgPath => {
					if (!pkgPath || !pkgPath.trim()) {
						return;
					}
					let index = pkgPath.lastIndexOf('/');
					let pkgName = index === -1 ? pkgPath : pkgPath.substr(index + 1);
					pkgs.set(pkgPath, pkgName);
				});
				return resolve(pkgs);
			}

			output.split('\n').forEach((pkgDetail) => {
				if (!pkgDetail || !pkgDetail.trim() || pkgDetail.indexOf(';') === -1) return;
				let [pkgName, pkgPath] = pkgDetail.trim().split(';');
				pkgs.set(pkgPath, pkgName);
			});

			let timeTaken = Date.now() - t0;
			/* __GDPR__
				"gopkgs" : {
					"tool" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"timeTaken": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
				}
			*/
			sendTelemetryEvent('gopkgs', {}, { timeTaken });
			cacheTimeout = timeTaken > 5000 ? timeTaken : 5000;
			return resolve(pkgs);
		});
	});
}

function getAllPackagesNoCache(): Promise<Map<string, string>> {
	return new Promise<Map<string, string>>((resolve, reject) => {
		// Use subscription style to guard costly/long running invocation
		let callback = function (pkgMap: Map<string, string>) {
			resolve(pkgMap);
		};
		gopkgsSubscriptions.push(callback);

		// Ensure only single gokpgs running
		if (!gopkgsRunning) {
			gopkgsRunning = true;
			gopkgs().then((pkgMap) => {
				gopkgsRunning = false;

				let subs = gopkgsSubscriptions;
				gopkgsSubscriptions = [];

				subs.forEach((callback) => callback(pkgMap));
			});
		}
	});
}

/**
 * Runs gopkgs
 * @returns Map<string, string> mapping between package import path and package name
 */
export function getAllPackages(): Promise<Map<string, string>> {
	let useCache = allPkgsCache && allPkgsLastHit && (new Date().getTime() - allPkgsLastHit) < cacheTimeout;
	if (useCache) {
		allPkgsLastHit = new Date().getTime();
		return Promise.resolve(allPkgsCache);
	}

	return getAllPackagesNoCache().then((pkgs) => {
		if (!pkgs || pkgs.size === 0) {
			console.log('Could not find packages. Ensure `gopkgs -format {{.Name}};{{.ImportPath}}` runs successfully.');
			if (!gopkgsNotified) {
				vscode.window.showInformationMessage('Could not find packages. Ensure `gopkgs -format {{.Name}};{{.ImportPath}}` runs successfully.');
				gopkgsNotified = true;
			}
		}
		allPkgsLastHit = new Date().getTime();
		return allPkgsCache = pkgs;
	});
}

/**
 * Returns mapping of import path and package name for packages that can be imported
 * Possible to return empty if useCache options is used.
 * @param filePath. Used to determine the right relative path for vendor pkgs
 * @param useCache. Force to use cache
 * @returns Map<string, string> mapping between package import path and package name
 */
export function getImportablePackages(filePath: string, useCache: boolean = false): Promise<Map<string, string>> {
	let getAllPackagesPromise: Promise<Map<string, string>>;
	if (useCache) {
		// forced to use cache
		getAllPackagesPromise = Promise.race([getAllPackages(), allPkgsCache]);
	} else {
		getAllPackagesPromise = getAllPackages();
	}

	filePath = fixDriveCasingInWindows(filePath);

	return Promise.all([isVendorSupported(), getAllPackagesPromise]).then(([vendorSupported, pkgs]) => {
		let pkgMap = new Map<string, string>();
		if (!pkgs) {
			return pkgMap;
		}

		let currentFileDirPath = path.dirname(filePath);
		let currentWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), currentFileDirPath);
		pkgs.forEach((pkgName, pkgPath) => {
			if (pkgName === 'main') {
				return;
			}

			if (!vendorSupported || !currentWorkspace) {
				pkgMap.set(pkgPath, pkgName);
				return;
			}

			let relativePkgPath = getRelativePackagePath(currentFileDirPath, currentWorkspace, pkgPath);
			if (!relativePkgPath) {
				return;
			}

			let allowToImport = isAllowToImportPackage(currentFileDirPath, currentWorkspace, relativePkgPath);
			if (allowToImport) {
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
function getRelativePackagePath(currentFileDirPath: string, currentWorkspace: string, pkgPath: string): string {
	let magicVendorString = '/vendor/';
	let vendorIndex = pkgPath.indexOf(magicVendorString);
	if (vendorIndex === -1) {
		magicVendorString = 'vendor/';
		if (pkgPath.startsWith(magicVendorString)) {
			vendorIndex = 0;
		}
	}
	// Check if current file and the vendor pkg belong to the same root project and not sub vendor
	// If yes, then vendor pkg can be replaced with its relative path to the "vendor" folder
	// If not, then the vendor pkg should not be allowed to be imported.
	if (vendorIndex > -1) {
		let rootProjectForVendorPkg = path.join(currentWorkspace, pkgPath.substr(0, vendorIndex));
		let relativePathForVendorPkg = pkgPath.substring(vendorIndex + magicVendorString.length);
		let subVendor = relativePathForVendorPkg.indexOf('/vendor/') !== -1;

		if (relativePathForVendorPkg && currentFileDirPath.startsWith(rootProjectForVendorPkg) && !subVendor) {
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
			if (!pkgs[pkgs.length - 1]) {
				pkgs.splice(pkgs.length - 1);
			}
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

// This will check whether it's regular package or internal package
// Regular package will always allowed
// Internal package only allowed if the package doing the import is within the tree rooted at the parent of "internal" directory
// see: https://golang.org/doc/go1.4#internalpackages
// see: https://golang.org/s/go14internal
export function isAllowToImportPackage(toDirPath: string, currentWorkspace: string, pkgPath: string) {
	let internalPkgFound = pkgPath.match(/\/internal\/|\/internal$/);
	if (internalPkgFound) {
		let rootProjectForInternalPkg = path.join(currentWorkspace, pkgPath.substr(0, internalPkgFound.index));
		return toDirPath.startsWith(rootProjectForInternalPkg + path.sep) || toDirPath === rootProjectForInternalPkg;
	}
	return true;
}
