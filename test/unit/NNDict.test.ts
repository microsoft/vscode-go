/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import * as assert from 'assert';
import { Node, NearestNeighborDict } from '../../src/avlTree';

suite('NearestNeighborDict Tests', () => {
	test('basic insert/get: random', () => {
		let dict = new NearestNeighborDict(new Node(0, 0), NearestNeighborDict.NUMERIC_DISTANCE_FUNCTION);
		let entries = [5, 2, 9, 23, 3, 0, 1, -4, -2];
		entries.forEach(x => dict.insert(x));
		assert(dict.height() < 4);

		entries.forEach(x => {
			assert.equal(dict.getNearest(x + 0.1).key, x);
			assert.equal(dict.getNearest(x - 0.1).key, x);
		});

		assert.equal(dict.getNearest(23 + 10).key, 23);
		assert.equal(dict.getNearest(23 - 4).key, 23);
	});

	test('basic insert/get: increasing', () => {
		let dict = new NearestNeighborDict(new Node(0, 0), NearestNeighborDict.NUMERIC_DISTANCE_FUNCTION);
		let entries = [-10, -5, -4, -1, 0, 1, 5, 10, 23];
		entries.forEach(x => dict.insert(x));
		assert(dict.height() < 4);

		entries.forEach(x => {
			assert.equal(dict.getNearest(x + 0.1).key, x);
			assert.equal(dict.getNearest(x - 0.1).key, x);
		});

		assert.equal(dict.getNearest(23 + 10).key, 23);
		assert.equal(dict.getNearest(23 - 4).key, 23);
	});

	test('basic insert/get: decreasing', () => {
		let dict = new NearestNeighborDict(new Node(0, 0), NearestNeighborDict.NUMERIC_DISTANCE_FUNCTION);
		let entries = [-10, -5, -4, -1, 0, 1, 5, 10, 23].reverse();
		entries.forEach(x => dict.insert(x));
		assert(dict.height() < 4);

		entries.forEach(x => {
			assert.equal(dict.getNearest(x + 0.1).key, x);
			assert.equal(dict.getNearest(x - 0.1).key, x);
		});

		assert.equal(dict.getNearest(23 + 10).key, 23);
		assert.equal(dict.getNearest(23 - 4).key, 23);
	});
});
