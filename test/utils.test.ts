
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import { guessPackageNameFromFile } from '../src/util';
import * as assert from 'assert';
import { substituteEnv } from '../src/util';
import { expandFilePathInOutput } from '../src/testUtils';
import path = require('path');

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

suite('expandFilePathInOutput tests', () => {
	test('expand path test' , () => {
		const testMessage = 'demo_test.go:11: No';
		const testDir = '/home/user/expand/path/';
		const expectedTestMessage = path.join(testDir, testMessage);
		const outputMessage = expandFilePathInOutput(testMessage, testDir);

		// Check the validity of the expected output
		assert.equal(outputMessage, expectedTestMessage);
	});

	test('windows compile error expand path test' , () => {
		const sampleErrorMessage = '.\\sample.go:11:3: syntax error';
		const testDir = 'D:/Test/Expand Path/';
		const expectedPathMessage = path.join(testDir, sampleErrorMessage);
		const outputMessage = expandFilePathInOutput(sampleErrorMessage, testDir);

		// Check the validity of the expected output
		assert.equal(outputMessage, expectedPathMessage);
	});
	test('*nix compile error expand path test' , () => {
		const sampleErrorMessage = './sample.go:11:3: syntax error';
		const testDir = '/home/user/expand/path/';
		const expectedPathMessage = path.join(testDir, sampleErrorMessage);
		const outputMessage = expandFilePathInOutput(sampleErrorMessage, testDir);

		// Check the validity of the expected output
		assert.equal(outputMessage, expectedPathMessage);
	});
});
