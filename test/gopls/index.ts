/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/
import * as glob from 'glob';
import * as Mocha from 'mocha';
import * as path from 'path';
export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd'
	});
	mocha.useColors(true);

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise((c, e) => {
		glob('gopls/**.test.js', { cwd: testsRoot }, (err, files) => {
			if (err) {
				return e(err);
			}

			// Add files to the test suite
			files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

			try {
				// Run the mocha test
				mocha.run((failures) => {
					if (failures > 0) {
						e(new Error(`${failures} tests failed.`));
					} else {
						c();
					}
				});
			} catch (err) {
				e(err);
			}
		});
	});
}
