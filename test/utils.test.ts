/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import { guessPackageNameFromFile } from '../src/util';
import * as assert from 'assert';
import { substituteEnv } from '../src/util';

suite('utils Tests', () => {
	test('substituteEnv: default', () => {
		// prepare test
		const env = Object.assign({}, process.env);
		process.env['test1'] = 'abcd';
		process.env['test2'] = 'defg';

		let actual = substituteEnv(
			' ${env:test1} \r\n ${env:test2}\r\n${env:test1}'
		);
		let expected = ' abcd \r\n defg\r\nabcd';

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
});

