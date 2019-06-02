import Parser = require('web-tree-sitter');
import { colorGo } from '../../src/treeSitterColor';
import * as assert from 'assert';

type check = [string, string | { not: string }];
type TestCase = [string, ...check[]];

const testCases: TestCase[] = [
	[
		`func f() int { }`,
		['f', 'entity.name.function'], ['int', 'entity.name.type']
	],
	[
		`type Foo struct { x int }`,
		['Foo', 'entity.name.type'], ['x', { not: 'variable' }]
	],
	[
		`type Foo interface { GetX() int }`,
		['Foo', 'entity.name.type'], ['int', 'entity.name.type'], ['GetX', { not: 'variable' }]
	],
	[
		`func f() { x := 1; x := 2 }`,
		['x', 'markup.underline']
	],
	[
		`func f(foo T) { foo.Foo() }`,
		['Foo', { not: 'entity.name.function' }]
	],
	[
		`func f() { Foo() }`,
		['Foo', 'entity.name.function']
	],
	[
		`import "foo"; func f() { foo.Foo() }`,
		['Foo', 'entity.name.function']
	],
	[
		`import "foo"; func f(foo T) { foo.Foo() }`,
		['Foo', { not: 'entity.name.function' }]
	],
	[
		`func f(x other.T) { }`,
		['T', 'entity.name.type'],
	],
	[
		`var _ = f(Foo{})`,
		['Foo', 'entity.name.type'],
	],
	[
		`import (foo "foobar"); var _ = foo.Bar()`,
		['foo', { not: 'variable' }], ['Bar', 'entity.name.function'],
	],
	[
		`func f(a int) int {
            switch a {
            case 1:
                x := 1
                return x
            case 2:
                x := 2
                return x
            }
        }`,
		['x', { not: 'markup.underline' }]
	],
	[
		`func f(a interface{}) int {
            switch a.(type) {
            case *int:
                x := 1
                return x
            case *int:
                x := 2
                return x
            }
        }`,
		['x', { not: 'markup.underline' }]
	],
	[
		`func f(a interface{}) int {
            for i := range 10 {
                print(i)
            }
            for i := range 10 {
                print(i)
            }
        }`,
		['i', { not: 'markup.underline' }]
	],
	[
		`func f(a interface{}) int {
            if i := 1; i < 10 {
                print(i)
            }
            if i := 1; i < 10 {
                print(i)
            }
        }`,
		['i', { not: 'markup.underline' }]
	],
	[
		`func f(a interface{}) {
            switch aa := a.(type) {
                case *int:
                    print(aa)
            }
        }`,
		['aa', { not: 'variable' }]
	],
	[
		`func f() {
            switch aa.(type) {
                case *int:
                    print(aa)
            }
        }`,
		['aa', 'variable']
	],
	[
		`func f(a interface{}) {
            switch aa := a.(type) {
                case *int:
                    print(aa)
            }
            switch aa := a.(type) {
                case *int:
                    print(aa)
            }
        }`,
		['aa', { not: 'markup.underline' }]
	],
	[
		`func f(a ...int) {
            print(a)
        }`,
		['a', { not: 'variable' }]
	],
];

async function createParser() {
	await Parser.init();
	const parser = new Parser();
	const wasm = 'parsers/tree-sitter-go.wasm';
	const lang = await Parser.Language.load(wasm);
	parser.setLanguage(lang);
	return parser;
}

suite('Syntax coloring', () => {
	const parser = createParser();

	for (const [src, ...expect] of testCases) {
		test(src, async () => {
			const tree = (await parser).parse(src);
			const found = colorGo(tree.rootNode, [{ start: 0, end: tree.rootNode.endPosition.row }]);
			const foundMap = new Map<string, Set<string>>();
			for (const scope of Object.keys(found)) {
				for (const node of found[scope]) {
					const code = node.text;
					if (!foundMap.has(code)) {
						foundMap.set(code, new Set<string>());
					}
					foundMap.get(code)!.add(scope);
				}
			}
			function printSrcAndTree() {
				console.error('Source:\t' + src);
				console.error('Parsed:\t' + tree.rootNode.toString());
			}
			for (const [code, check] of expect) {
				if (typeof check === 'string') {
					const scope = check;
					if (!foundMap.has(code)) {
						printSrcAndTree();
						assert.fail(`Error:\tcode (${code}) was not found in (${join(foundMap.keys())})`);
						continue;
					}
					const foundScopes = foundMap.get(code)!;
					if (!foundScopes.has(scope)) {
						printSrcAndTree();
						assert.fail(`Error:\tscope (${scope}) was not among the scopes for (${code}) (${join(foundScopes.keys())})`);
						continue;
					}
				} else {
					const scope = check.not;
					if (!foundMap.has(code)) {
						continue;
					}
					const foundScopes = foundMap.get(code)!;
					if (foundScopes.has(scope)) {
						printSrcAndTree();
						assert.fail(`Error:\tbanned scope (${scope}) was among the scopes for (${code}) (${join(foundScopes.keys())})`);
						continue;
					}
				}
			}
		});
	}
});

function join(strings: IterableIterator<string>) {
	let result = '';
	for (const s of strings) {
		result = result + s + ', ';
	}
	return result.substring(0, result.length - 2);
}
