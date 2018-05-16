import vscode = require('vscode');
import cp = require('child_process');
import path = require('path');
import { getGoRuntimePath, getCurrentGoWorkspaceFromGOPATH, fixDriveCasingInWindows } from './goPath';
import { isVendorSupported, getCurrentGoPath, getToolsEnvVars, getGoVersion, getBinPath, SemVersion, sendTelemetryEvent } from './util';
import { promptForMissingTool, promptForUpdatingTool } from './goInstallTools';

type GopkgsDone = (res: Map<string, string>) => void;
interface Cache {
	entry: Map<string, string>;
	lastHit: number;
}

let gopkgsNotified: boolean = false;
let cacheTimeout: number = 5000;

let gopkgsSubscriptions: Map<string, GopkgsDone[]> = new Map<string, GopkgsDone[]>();
let gopkgsRunning: Set<string> = new Set<string>();

let allPkgsCache: Map<string, Cache> = new Map<string, Cache>();

let pkgRootDirs = new Map<string, string>();

function gopkgs(workDir?: string): Promise<Map<string, string>> {
	let t0 = Date.now();
	return new Promise<Map<string, string>>((resolve, reject) => {
		const args = ['-format', '{{.Name}};{{.ImportPath}}'];
		if (workDir) {
			args.push('-workDir', workDir);
		}

		const cmd = cp.spawn(getBinPath('gopkgs'), args, { env: getToolsEnvVars() });
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

			const errorMsg = errchunks.join('').trim() || err.message;
			if (errorMsg.startsWith('flag provided but not defined: -workDir')) {
				promptForUpdatingTool('gopkgs');
				// fallback to gopkgs without -workDir
				return gopkgs().then(result => resolve(result));
			}

			if (errorMsg) {
				console.log(`Running gopkgs failed with "${errorMsg}"\nCheck if you can run \`gopkgs -format {{.Name}};{{.ImportPath}}\` in a terminal successfully.`);
				return resolve(pkgs);
			}

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

function getAllPackagesNoCache(workDir?: string): Promise<Map<string, string>> {
	return new Promise<Map<string, string>>((resolve, reject) => {
		// Use subscription style to guard costly/long running invocation
		let callback = function (pkgMap: Map<string, string>) {
			resolve(pkgMap);
		};

		let subs = gopkgsSubscriptions.get(workDir);
		if (!subs) {
			subs = [];
			gopkgsSubscriptions.set(workDir, subs);
		}
		subs.push(callback);

		// Ensure only single gokpgs running
		if (!gopkgsRunning.has(workDir)) {
			gopkgsRunning.add(workDir);

			gopkgs(workDir).then((pkgMap) => {
				gopkgsRunning.delete(workDir);
				gopkgsSubscriptions.delete(workDir);
				subs.forEach((callback) => callback(pkgMap));
			});
		}
	});
}

/**
 * Runs gopkgs
 * @argument workDir. The workspace directory of the project.
 * @returns Map<string, string> mapping between package import path and package name
 */
export function getAllPackages(workDir?: string): Promise<Map<string, string>> {
	let cache = allPkgsCache.get(workDir);
	let useCache = cache && (new Date().getTime() - cache.lastHit) < cacheTimeout;
	if (useCache) {
		cache.lastHit = new Date().getTime();
		return Promise.resolve(cache.entry);
	}

	return getAllPackagesNoCache(workDir).then((pkgs) => {
		if (!pkgs || pkgs.size === 0) {
			if (!gopkgsNotified) {
				vscode.window.showInformationMessage('Could not find packages. Ensure `gopkgs -format {{.Name}};{{.ImportPath}}` runs successfully.');
				gopkgsNotified = true;
			}
		}

		allPkgsCache.set(workDir, {
			entry: pkgs,
			lastHit: new Date().getTime()
		});
		return pkgs;
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
	filePath = fixDriveCasingInWindows(filePath);
	let getAllPackagesPromise: Promise<Map<string, string>>;
	let fileDirPath = path.dirname(filePath);

	let foundPkgRootDir = pkgRootDirs.get(fileDirPath);
	let workDir = foundPkgRootDir || fileDirPath;
	let cache = allPkgsCache.get(workDir);

	if (useCache && cache) {
		getAllPackagesPromise = Promise.race([getAllPackages(workDir), cache.entry]);
	} else {
		getAllPackagesPromise = getAllPackages(workDir);
	}


	return Promise.all([isVendorSupported(), getAllPackagesPromise]).then(([vendorSupported, pkgs]) => {
		let pkgMap = new Map<string, string>();
		if (!pkgs) {
			return pkgMap;
		}

		let currentWorkspace = getCurrentGoWorkspaceFromGOPATH(getCurrentGoPath(), fileDirPath);
		pkgs.forEach((pkgName, pkgPath) => {
			if (pkgName === 'main') {
				return;
			}

			if (!vendorSupported || !currentWorkspace) {
				pkgMap.set(pkgPath, pkgName);
				return;
			}

			if (!foundPkgRootDir) {
				// try to guess package root dir
				let vendorIndex = pkgPath.indexOf('/vendor/');
				if (vendorIndex !== -1 ) {
					foundPkgRootDir = path.join(currentWorkspace, pkgPath.substring(0, vendorIndex).replace('/', path.sep));
					pkgRootDirs.set(fileDirPath, foundPkgRootDir);
				}
			}

			let relativePkgPath = getRelativePackagePath(fileDirPath, currentWorkspace, pkgPath);
			if (!relativePkgPath) {
				return;
			}

			let allowToImport = isAllowToImportPackage(fileDirPath, currentWorkspace, relativePkgPath);
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
function isAllowToImportPackage(toDirPath: string, currentWorkspace: string, pkgPath: string) {
	let internalPkgFound = pkgPath.match(/\/internal\/|\/internal$/);
	if (internalPkgFound) {
		let rootProjectForInternalPkg = path.join(currentWorkspace, pkgPath.substr(0, internalPkgFound.index));
		return toDirPath.startsWith(rootProjectForInternalPkg + path.sep) || toDirPath === rootProjectForInternalPkg;
	}
	return true;
}
