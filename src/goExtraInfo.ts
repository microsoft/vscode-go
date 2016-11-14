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
			if (definitionInfo == null) return null;
			let lines = definitionInfo.lines;
			lines = lines.filter(line => line.length !== 0);
			if (lines.length > 10) lines[9] = '...';
			let text;
			text = lines.slice(0, 10).join('\n');
			text = text.replace(/\n+$/, '');
			let hoverTexts: MarkedString[] = [];
			if (definitionInfo.doc != null) {
				hoverTexts.push(definitionInfo.doc);
			}
			hoverTexts.push({ language: 'go', value: text});
			let hover = new Hover(hoverTexts);
			return hover;
		});
	}
}
