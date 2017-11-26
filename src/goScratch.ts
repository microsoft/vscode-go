'use strict';

import vscode = require('vscode');
import cp = require('child_process');
import os = require('os');
import path = require('path');
import { getGoRuntimePath } from './goPath';
import { outputChannel } from './goStatus';

const tmpPath = path.normalize(path.join(os.tmpdir(), 'go-scratch', 'scratch.go'));
let template = `package main

import (
	"fmt"
)

func main() {
	fmt.Println("Hello World!")
}`;

export function createScratch(): void {
	vscode.workspace.openTextDocument(tmpPath)
		.then(doc => createExisting(doc), () => createNew(vscode.Uri.parse('untitled:' + tmpPath)));
}

function createExisting(doc: vscode.TextDocument) {
	vscode.window.showTextDocument(doc)
		.then(editor => editor.edit(builder => builder.replace(rangeAll(doc), template)))
		.then(() => doc.save());
}

function createNew(newfile: vscode.Uri) {
	vscode.workspace.openTextDocument(newfile)
		.then(doc => createExisting(doc));
}

function rangeAll(doc: vscode.TextDocument): vscode.Range {
	return new vscode.Range(new vscode.Position(0, 0), doc.positionAt(doc.getText().length));
}

export function runScratch(): void {
	outputChannel.clear();
	outputChannel.show(2);
	let proc = cp.spawn(getGoRuntimePath(), ['run', tmpPath], { env: process.env });
	proc.stdout.on('data', chunk => outputChannel.append(chunk.toString()));
	proc.stderr.on('data', chunk => outputChannel.append(chunk.toString()));
	proc.on('close', code => outputChannel.append('\n[Exited with code ' + code + ']'));
}