import vscode = require('vscode');

let globalState: vscode.Memento;

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
