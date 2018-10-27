/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import vscode = require("vscode");
import path = require("path");
import {
	guessPackageNameFromFile,
	runTool,
	getTempFilePath,
	getWorkspaceFolderPath
} from "../../src/util";
import * as assert from "assert";
import { substituteEnv } from "../../src/util";

suite("utils Tests", () => {
	test("substituteEnv: default", () => {
		// prepare test
		const env = Object.assign({}, process.env);
		process.env["test1"] = "abcd";
		process.env["test2"] = "defg";

		let actual = substituteEnv(
			" ${env:test1} \r\n ${env:test2}\r\n${env:test1}"
		);
		let expected = " abcd \r\n defg\r\nabcd";

		assert.equal(actual, expected);

		// test completed
		process.env = env;
	});
});

suite("GuessPackageNameFromFile Tests", () => {
	test("package name from main file", done => {
		const packageName = "main";
		const filename = "main.go";

		guessPackageNameFromFile(filename)
			.then(result => {
				assert.equal(result, packageName);
			})
			.then(() => done(), done);
	});

	test("package name from dirpath", done => {
		const packageName = "package";
		const fileDir = "path/package/file.go";

		guessPackageNameFromFile(fileDir)
			.then(([result]) => {
				assert.equal(result, packageName);
			})
			.then(() => done(), done);
	});

	test("package name from test file", done => {
		const packageName = "file";
		const packageTestName = "file_test";
		const fileDir = "file_test.go";

		guessPackageNameFromFile(fileDir)
			.then(([packageNameResult, packageTestNameResult]) => {
				assert.equal(packageNameResult, packageName);
				assert.equal(packageTestNameResult, packageTestName);
			})
			.then(() => done(), done);
	});
});

suite("RunTool Tests", () => {
	test("go version command", done => {
		runTool(["version"], null, null, false, null, null, true, null)
			.then(result => {
				assert.equal(result.length, 0);
			})
			.then(() => done(), done);
	});

	test("go clean command", done => {
		runTool(["clean"], ".", null, false, "go", null, true, null)
			.then(result => {
				assert.equal(result.length, 0);
			})
			.then(() => done(), done);
	});
});

suite("GetWorkspaceFolderPath Tests", () => {
	test("workspace from ...", () => {
		let uri = vscode.workspace.workspaceFolders[0].uri;
		const result = getWorkspaceFolderPath(uri);
		assert("test", path.basename(result));
	});
});

suite("GetTempFilePath Tests", () => {
	test("file temporal file path", () => {
		const result = getTempFilePath("file.go");
		assert("file.go", path.basename(result));
	});
});
