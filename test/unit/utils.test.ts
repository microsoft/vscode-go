/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import * as assert from 'assert';
import { substituteEnv } from '../../src/util';

suite('utils Tests', () => {
	test('substituteEnv: default', () => {

		// prepare test
		const env = Object.assign({}, process.env);
		process.env['test1'] = 'abcd';
		process.env['test2'] = 'defg';

		let actual = substituteEnv(' ${env:test1} \r\n ${env:test2}\r\n${env:test1}');
		let expected = ' abcd \r\n defg\r\nabcd';

		assert.equal(actual, expected);

		// test completed
		process.env = env;
	});
});