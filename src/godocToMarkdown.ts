/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

// Implementation is based on https://github.com/golang/go/blob/master/src/go/doc/comment.go

import * as XRegExp from 'xregexp';

// Regex is based on https://github.com/kemitchell/markdown-escape.js/blob/master/index.js
const markdownEscape = (text: string): string => {
	return text.replace(/([\\`*{}[\]()#+-.!_>~|\n"$%&',\/:;<=?@^])/g, '\\$1');
};

// Escape comment text for Markdown. If nice is set,
// also turn `` into '“' and '' into '”'.
const commentEscape = (text: string, nice: boolean): string => {
	return nice
		? markdownEscape(convertQuotes(text))
		: markdownEscape(text);
};

const convertQuotes = (text: string): string => {
	return text.replace('``', '“').replace('\'\'', '”');
};

// Regexp for Go identifiers
const identRx = '[\\p{L}_][\\p{L}_0-9]*';

// Regexp for URLs
// Match parens, and check later for balance - see #5043, #22285
// Match .,:;?! within path, but not at end - see #18139, #16565
// This excludes some rare yet valid urls ending in common punctuation
// in order to allow sentences ending in URLs.

// protocol (required) e.g. http
const protoPart = '(https?|ftp|file|gopher|mailto|nntp)';
// host (required) e.g. www.example.com or [::1]:8080
const hostPart = '([a-zA-Z0-9_@\\-.\\[\\]:]+)';
// path+query+fragment (optional) e.g. /path/index.html?q=foo#bar
const pathPart = '([.,:;?!]*[a-zA-Z0-9$\'()*+&#=@~_/\\-\\[\\]%])*';

const urlRx = protoPart + `://` + hostPart + pathPart;

const matchRx = '(' + urlRx + ')|(' + identRx + ')';

// Emphasize and escape a line of text for Markdown. URLs are converted into links;
// if the URL also appears in the words map, the link is taken from the map (if
// the corresponding map value is the empty string, the URL is not converted
// into a link). Go identifiers that appear in the words map are italicized; if
// the corresponding map value is not the empty string, it is considered a URL
// and the word is converted into a link. If nice is set, the remaining text's
// appearance is improved where it makes sense (e.g., `` is turned into &ldquo;
// and '' into &rdquo;).
const emphasize = (line: string, words: { [key: string]: string }, nice: boolean): string => {
	const parts = [];

	const regexp = XRegExp(matchRx, 'gu');
	while (true) {
		let m = XRegExp.exec(line, regexp);
		if (m == null) {
			break;
		}
		// m >= 3 (two parenthesized sub-regexps in matchRx, 1st one is urlRx)

		// Write text before match
		parts.push(commentEscape(line.slice(0, m.index), nice));

		// Adjust match for URLs
		let match = m[0];
		if (match.includes('://')) {
			const m0 = m.index;
			let m1 = m[0].length;
			for (const s of [['(', ')'], ['{', '}'], ['[', ']']]) {
				const open = s[0], close = s[1];
				// Require opening parentheses before closing parentheses (#22285)
				const i = match.indexOf(close);
				if (i >= 0 && i < match.indexOf(open)) {
					m1 = m0 + i;
					match = line.slice(m0, m1);
				}
				// Require balanced pairs of parentheses (#5043)
				for (let i = 0; (XRegExp.match(match, XRegExp(`\\${open}`, 'g'))).length !== (XRegExp.match(match, XRegExp(`\\${close}`, 'g'))).length && i < 10; i++) {
					const shortenedLine = line.slice(0, m1);
					const parenRegex = XRegExp(`[\\${open}\\${close}]`, 'g');
					let prevMatch2 = null;
					while (true) {
						const match2 = XRegExp.exec(shortenedLine, parenRegex);
						if (match2 == null) {
							m1 = prevMatch2.index;
							break;
						}
						prevMatch2 = match2;
					}
					match = line.slice(m0, m1);
				}
			}
			if (m1 !== m[0].length) {
				// Redo matching with shortened line for correct indices
				m = XRegExp.exec(line.slice(0, m.index + match.length), XRegExp(matchRx, 'gu'));
			}
		}

		// Analyze match
		let url = '';
		let italics = false;
		if (words != null) {
			if (words.hasOwnProperty(match)) {
				url = words[match];
				italics = true;
			}
		}
		if (m[1] != null) {
			// Match against first parenthesized sub-regexp; must be match against urlRx
			if (!italics) {
				// No alternative URL in words list, use match instead
				url = match;
			}
			italics = false; // Don't italicize URLs
		}

		// Write match
		if (url.length > 0) {
			parts.push('[');
		}
		if (italics) {
			parts.push('*');
		}
		parts.push(commentEscape(match, nice));
		if (italics) {
			parts.push('*');
		}
		if (url.length > 0) {
			parts.push('](', url.replace(')', '\\)'), ')');
		}

		// Advance
		line = line.slice(m.index + m[0].length);
	}
	parts.push(commentEscape(line, nice));

	return parts.join('');
};

const indentLen = (s: string): number => {
	let i = 0;
	while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
		i++;
	}
	return i;
};

const isBlank = (s: string): boolean => {
	return s.length === 0 || (s.length === 1 && s[0] === '\n');
};

const commonPrefix = (a: string, b: string): string => {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) {
		i++;
	}
	return a.slice(0, i);
};

const unindent = (block: string[]) => {
	if (block.length === 0) {
		return;
	}

	// Compute maximum common white prefix
	let prefix = block[0].slice(0, indentLen(block[0]));
	for (const line of block) {
		if (!isBlank(line)) {
			prefix = commonPrefix(prefix, line.slice(0, indentLen(line)));
		}
	}
	const n = prefix.length;

	// Remove
	for (let i = 0; i < block.length; i++) {
		const line = block[i];
		if (!isBlank(line)) {
			block[i] = line.slice(n);
		}
	}
};

// heading returns the trimmed line if it passes as a section heading;
// otherwise it returns the empty string.
const heading = (line: string): string => {
	line = line.trim();
	if (line.length === 0) {
		return '';
	}

	// A heading must start with an uppercase letter
	let r = line.charAt(0);
	if (!XRegExp('\\p{Lu}', 'u').test(r)) {
		return '';
	}

	// It must end in a letter or digit
	r = line.charAt(line.length - 1);
	if (!XRegExp('\\p{L}|\\p{Nd}', 'u').test(r)) {
		return '';
	}

	// Exclude lines with illegal characters. we allow "(),"
	if (XRegExp('[;:!?+*/=[\\]{}_^°&§~%#@<">\\\\]').test(line)) {
		return '';
	}

	// Allow "'" for possessive "'s" only
	for (let b = line; ;) {
		const i = b.indexOf('\'');
		if (i < 0) {
			break;
		}
		if (i + 1 >= b.length || b[i + 1] !== 's' || (i + 2 < b.length && b[i + 2] !== ' ')) {
			return ''; // not followed by "s "
		}
		b = b.slice(i + 2);
	}

	// allow "." when followed by non-space
	for (let b = line; ;) {
		const i = b.indexOf('.');
		if (i < 0) {
			break;
		}
		if (i + 1 >= b.length || b[i + 1] === ' ') {
			return ''; // not followed by non-space
		}
		b = b.slice(i + 1);
	}

	return line;
};

enum Op {
	Para,
	Head,
	Pre,
}

interface Block {
	op: Op;
	lines: string[];
}

function* blocks(text: string): IterableIterator<Block> {
	let para: any[] | string[] = [];
	let lastWasBlank = false;
	let lastWasHeading = false;

	const close = () => {
		if (para.length > 0) {
			const block = { op: Op.Para, lines: para };
			para = [];
			return block;
		}

		return undefined;
	};

	const lines = text.split('\n');
	unindent(lines);
	for (let i = 0; i < lines.length;) {
		const line = lines[i];
		if (isBlank(line)) {
			// Close paragraph
			const block = close();
			if (block) {
				yield block;
			}
			i++;
			lastWasBlank = true;
			continue;
		}
		if (indentLen(line) > 0) {
			// Close paragraph
			const block = close();
			if (block) {
				yield block;
			}

			// Count indented or blank lines
			let j = i + 1;
			while (j < lines.length && (isBlank(lines[j]) || indentLen(lines[j]) > 0)) {
				j++;
			}
			// But not trailing blank lines
			while (j > i && isBlank(lines[j - 1])) {
				j--;
			}
			const pre = lines.slice(i, j);
			i = j;

			unindent(pre);

			// Put those lines in a pre block
			yield { op: Op.Pre, lines: pre };
			lastWasHeading = false;
			continue;
		}

		if (lastWasBlank && !lastWasHeading && i + 2 < lines.length &&
			isBlank(lines[i + 1]) && !isBlank(lines[i + 2]) && indentLen(lines[i + 2]) === 0) {
			// Current line is non-blank, surrounded by blank lines
			// and the next non-blank line is not indented: this
			// might be a heading.
			const head = heading(line);
			if (head !== '') {
				const block = close();
				if (block) {
					yield block;
				}
				yield { op: Op.Head, lines: [head] };
				i += 2;
				lastWasHeading = true;
				continue;
			}
		}

		// Open paragraph
		lastWasBlank = false;
		lastWasHeading = false;
		para.push(lines[i]);
		i++;
	}
	const block = close();
	if (block) {
		yield block;
	}
}

export const godocToMarkdown = (text: string, words: { string: string }): string => {
	const parts = [];
	let printed = false;

	for (const b of blocks(text)) {
		switch (b.op) {
			case Op.Para:
				if (printed) {
					parts.push('\n');
				}
				for (const line of b.lines) {
					parts.push(emphasize(line, words, true) + '\n');
				}
				break;
			case Op.Head:
				parts.push('\n');
				if (printed) {
					parts.push('\n');
				}
				for (const line of b.lines) {
					parts.push('### ' + commentEscape(line, true) + '\n');
				}
				break;
			case Op.Pre:
				parts.push('\n');
				if (printed) {
					parts.push('\n');
				}
				for (const line of b.lines) {
					if (isBlank(line)) {
						parts.push('\n');
					} else {
						parts.push('    ' + line + '\n');
					}
				}
				break;
		}
		printed = true;
	}

	return parts.join('');
};
