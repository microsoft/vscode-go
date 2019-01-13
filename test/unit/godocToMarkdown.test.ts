import * as assert from 'assert';
import godocToMarkdown from '../../src/godocToMarkdown';

suite('godocToMarkdown Tests', () => {
	test('Single line comment', () => {
		assert.equal(godocToMarkdown(`foobar does qux\n`, null), `foobar does qux\n`);
	});

	test('Multi paragraph comment', () => {
		assert.equal(godocToMarkdown(`foo.

bar.

qux.\n`,
			null),
			`foo\\.

bar\\.

qux\\.
`);
	});

	test('Header', () => {
		assert.equal(godocToMarkdown(`foo.

Bar

qux.\n`,
			null),
			`foo\\.


### Bar

qux\\.\n`);
	});

	test('Preformatted', () => {
		assert.equal(godocToMarkdown(`foo.

	package main

	import "fmt"

	func main() {
		fmt.Println("Hello, World!\\n")
	}

qux.\n`.replace(/\t/g, '    '),
			null),
			`foo\\.


	package main

	import "fmt"

	func main() {
		fmt.Println("Hello, World!\\n")
	}

qux\\.\n`.replace(/\t/g, '    '));
	});

	test('Link', () => {
		assert.equal(godocToMarkdown(`https://golang.org/\n`, null), `[https\\:\\/\\/golang\\.org\\/](https://golang.org/)\n`);
	});

	test(`Smart quotes`, () => {
		assert.equal(godocToMarkdown(`\`\`Go''\n`, null), `“Go”\n`);
	});

	test(`Escapes emphasis`, () => {
		assert.equal(godocToMarkdown(`*foobar*\n`, null), `\\*foobar\\*\n`);
	});
});
