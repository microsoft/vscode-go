/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');
import { listPackages } from './goImport';

export class GoCodeActionProvider implements vscode.CodeActionProvider {
	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): Thenable<vscode.Command[]> {
		const promises = context.diagnostics.map((diag) => {
			// When a name is not found but could refer to a package, offer to add import
			if (diag.message.indexOf('undefined: ') === 0) {
				const [_, name] = /^undefined: (\S*)/.exec(diag.message);
				return listPackages().then((packages) => {
					const commands = packages
						.filter((pkg) => pkg === name || pkg.endsWith('/' + name))
						.map((pkg) => {
							return {
								title: 'import "' + pkg + '"',
								command: 'go.import.add',
								arguments: [{ importPath: pkg, from: 'codeAction' }]
							};
						});
					return commands;
				});
			}
			return [];
		});

		return Promise.all(promises).then((arrs) => {
			const results: { [key: string]: any } = {};
			for (const segment of arrs) {
				for (const item of segment) {
					results[item.title] = item;
				}
			}
			const ret = [];
			for (const title of Object.keys(results).sort()) {
				ret.push(results[title]);
			}
			return ret;
		});
	}
}
