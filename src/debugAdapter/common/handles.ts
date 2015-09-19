/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

export class Handles<T> {

	private START_HANDLE = 1000;

	private _nextHandle : number;
	private _handleMap = new Map<number, T>();

	public constructor() {
		this._nextHandle = this.START_HANDLE;
	}

	public reset(): void {
		this._nextHandle = this.START_HANDLE;
		this._handleMap = new Map<number, T>();
	}

	public create(value: T): number {
		var handle = this._nextHandle++;
		this._handleMap[handle] = value;
		return handle;
	}

	public get(handle: number, dflt?: T): T {
		return this._handleMap[handle] || dflt;
	}
}
