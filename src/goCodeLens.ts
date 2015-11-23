/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import {CancellationToken, CodeLens, CodeLensProvider, Location, Position, Range, TextDocument, Uri, window} from 'vscode';
import cp = require('child_process');
import {getBinPath} from './goPath'
import {GoOutlineDeclaration} from './goOutline'

class GoCodeLens extends CodeLens {
	fileName: string;
	decl: GoOutlineDeclaration;

	public constructor(fileName: string, decl: GoOutlineDeclaration, range: Range) {
		super(range);
		this.fileName = fileName;
		this.decl = decl;
	}
}

interface GoOracleResponse {
	implements?: GoOracleImplements;
}

interface GoOracleImplements {
	from?: GoOracleEntry[];
}

interface GoOracleEntry {
	name: string;
	pos: string;
	kind: string;
}

export class GoCodeLensProvider implements CodeLensProvider {
	private _oracleCmd: string;
	private _gooutlineCmd: string;

	public constructor() {
		this._oracleCmd = getBinPath("oracle");
		this._gooutlineCmd = getBinPath("go-outline");
	}

	public provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
		let convertDecl = (codeLens: CodeLens[], decl: GoOutlineDeclaration) => {
			if (decl.type == "function") {
				codeLens.push(new GoCodeLens(
					document.fileName,
					decl,
					new Range(document.positionAt(decl.start), document.positionAt(decl.end - 1)))
				)
			}
			if (decl.children) {
				for (let child of decl.children) {
					convertDecl(codeLens, child)
				}
			}
		}

		return new Promise((resolve, reject) => {
			try {
				cp.execFile(this._gooutlineCmd, ["-f", document.fileName], {}, (err, stdout, stderr) => {
					if (err && (<any>err).code == "ENOENT") {
						window.showInformationMessage("The 'go-outline' command is not available.  Use 'go get -u github.com/lukehoban/go-outline' to install.");
					}
					if (err) return resolve(null);

					let ret: CodeLens[] = [];
					let decls = <GoOutlineDeclaration[]>JSON.parse(stdout.toString());
					decls.forEach(decl => convertDecl(ret, decl))
					return resolve(ret)
				})
			} catch (e) {
				reject(e)
			}
		});
	}

	public resolveCodeLens(codeLens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
		if (codeLens instanceof GoCodeLens) {
			return this._runOracle("implements", codeLens.fileName, codeLens.decl.start, codeLens.decl.end).then(res => {
				if (!res || !res.implements || !res.implements.from) {
					return
				}
				let len = res.implements.from.length;
				codeLens.command = {
					title: len === 1 ? 'implements 1 type' : `implements ${len} types`,
					command: 'editor.action.showReferences',
					arguments: [Uri.file(codeLens.fileName), codeLens.range.start, res.implements.from.map(entry => {
						let pos = entry.pos.split(":");
						return new Location(Uri.file(pos[0]), new Position(+pos[1], +pos[2]));
					})]
				};
				return codeLens;
			});
		}
	}

	private _runOracle(mode: string, filename: string, start: number, end: number): Thenable<GoOracleResponse> {
		return new Promise((resolve, reject) => {
			try {
				let pos = '#' + start + ",#" + end
				cp.execFile(this._oracleCmd, ["-pos", filename + ":" + pos, "-format", "json", mode], {}, (err, stdout, stderr) => {
					if (err && (<any>err).code == "ENOENT") {
						window.showInformationMessage("The 'oracle' command is not available.  Use 'go get -u golang.org/x/tools/cmd/oracle' to install.");
					}
					if (err) return resolve(null);
					let res = <GoOracleResponse>JSON.parse(stdout.toString())
					return resolve(res)
				})
			} catch (e) {
				reject(e)
			}
		});
	}
}