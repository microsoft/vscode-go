/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import { HoverProvider, Hover, MarkedString, TextDocument, Position, CancellationToken, WorkspaceConfiguration, workspace } from 'vscode';
import { definitionLocation } from './goDeclaration';

export class GoHoverProvider implements HoverProvider {
	private goConfig = null;

	constructor(goConfig?: WorkspaceConfiguration) {
		this.goConfig = goConfig;
	}

	public provideHover(document: TextDocument, position: Position, token: CancellationToken): Thenable<Hover> {
		return definitionLocation(document, position, this.goConfig, true).then(definitionInfo => {
			if (definitionInfo == null) return null;
			let lines = definitionInfo.declarationlines
				.filter(line => !line.startsWith('\t//') && line !== '')
				.map(line => line.replace(/\t/g, '    '));
			let text;
			text = lines.join('\n').replace(/\n+$/, '');
			let hoverTexts: MarkedString[] = [];
			hoverTexts.push({ language: 'go', value: text });
			if (definitionInfo.doc != null) {
				hoverTexts.push(definitionInfo.doc);
			}
			let hover = new Hover(hoverTexts);
			return hover;
		}, () => {
			return null;
		});
	}
}
