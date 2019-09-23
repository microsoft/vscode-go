/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import * as assert from 'assert';
import { guessPackageNameFromFile, substituteEnv, GoVersion } from '../../src/util';

suite('utils Tests', () => {
	test('substituteEnv: default', () => {
		// prepare test
		const env = Object.assign({}, process.env);
		process.env['test1'] = 'abcd';
		process.env['test2'] = 'defg';

		const actual = substituteEnv(
			' ${env:test1} \r\n ${env:test2}\r\n${env:test1}'
		);
		const expected = ' abcd \r\n defg\r\nabcd';

		assert.equal(actual, expected);

		// test completed
		process.env = env;
	});
});

suite('GuessPackageNameFromFile Tests', () => {
	test('package name from main file', done => {
		const expectedPackageName = 'main';
		const filename = 'main.go';

		guessPackageNameFromFile(filename)
			.then(result => {
				assert.equal(result, expectedPackageName);
			})
			.then(() => done(), done);
	});

	test('package name from dirpath', done => {
		const expectedPackageName = 'package';
		const fileDir = 'path/package/file.go';

		guessPackageNameFromFile(fileDir)
			.then(([result]) => {
				assert.equal(result, expectedPackageName);
			})
			.then(() => done(), done);
	});

	test('package name from test file', done => {
		const expectedPackageName = 'file';
		const expectedPackageTestName = 'file_test';
		const fileDir = 'file_test.go';

		guessPackageNameFromFile(fileDir)
			.then(([packageNameResult, packageTestNameResult]) => {
				assert.equal(packageNameResult, expectedPackageName);
				assert.equal(packageTestNameResult, expectedPackageTestName);
			})
			.then(() => done(), done);
	});

	test('Parse Go version', () => {
		const versions = [
			{
				stdout: 'go version go1.13rc1 linux/amd64',
				want: '1.13',
			},
			{
				stdout: 'go version go1.12.9 windows/amd64',
				want: '1.12.9',
			},
			{
				stdout: 'go version devel +24781a1 Fri Sep 13 16:25:00 2019 +0000 linux/amd64',
				want: '(devel)',
			}
		];
		for (const v of versions) {
			const goVersion = new GoVersion(v.stdout);
			if (v.want === '(devel)') {
				assert(goVersion.isDevel);
				continue;
			}
			assert(goVersion.compare(v.want) === 0);
		}
	});
});
