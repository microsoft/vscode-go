/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import vscode = require('vscode');

let globalState: vscode.Memento;
let workspaceState: vscode.Memento;

export function getFromGlobalState(key: string, defaultValue?: any) {
	if (!globalState) {
		return defaultValue;
	}
	return globalState.get(key, defaultValue);
}

export function updateGlobalState(key: string, value: any) {
	if (!globalState) {
		return;
	}
	return globalState.update(key, value);
}

export function setGlobalState(state: vscode.Memento) {
	globalState = state;
}

export function getFromWorkspaceState(key: string, defaultValue?: any) {
	if (!workspaceState) {
		return defaultValue;
	}
	return workspaceState.get(key, defaultValue);
}

export function updateWorkspaceState(key: string, value: any) {
	if (!workspaceState) {
		return;
	}
	return workspaceState.update(key, value);
}

export function setWorkspaceState(state: vscode.Memento) {
	workspaceState = state;
}
