/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

'use strict';

import { HoverProvider, Hover, MarkedString, TextDocument, Position, CancellationToken } from 'vscode';
import { definitionLocation } from './goDeclaration';

export class GoHoverProvider implements HoverProvider {
	public provideHover(document: TextDocument, position: Position, token: CancellationToken): Thenable<Hover> {
		return definitionLocation(document, position, true).then(definitionInfo => {
			console.log(definitionInfo);
			if (definitionInfo == null) return null;
			let lines = definitionInfo.docInfo.decl.split('\n');
			lines = lines.filter(val => !val.startsWith('\t//')).map(line => {
				return line.replace(/\t/g, '    ');
			});
			lines = lines.filter(line => line.length !== 0);
			let text;
			if (lines.length > 1) {
				text = lines.join('\n').replace(/\n+$/, '');
			} else {
				text = lines[0];
			}
			let hoverTexts: MarkedString[] = [];
			hoverTexts.push({ language: 'go', value: text });
			if (definitionInfo.docInfo.doc != null) {
				hoverTexts.push(definitionInfo.docInfo.doc);
			}
			let hover = new Hover(hoverTexts);
			return hover;
		});
	}
}
