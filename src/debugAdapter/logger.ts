/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import { DebugSession, OutputEvent } from 'vscode-debugadapter';

enum LogLevel {
	Log,
	Error
}

export class Logger {
	constructor(private debugSession: DebugSession) {
	}

	log(msg: any): void {
		this._log(msg, LogLevel.Log);
	}

	error(msg: any): void {
		this._log(msg, LogLevel.Error);
	}

	private _log(msg: string, level:  LogLevel): void {
		if (typeof msg !== 'string') {
			msg = JSON.stringify(msg);
		}

		const category = level === LogLevel.Error ? 'stderr' : 'console';
		this.debugSession.sendEvent(new OutputEvent(msg, category));

		// and log to file?
	}
}
