/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as ee from 'events';

export class Message implements DebugProtocol.V8Message {
	seq: number;
	type: string;

	public constructor(type: string) {
		this.seq = 0;
		this.type = type;
	}
}

export class Response extends Message implements DebugProtocol.Response {
	request_seq: number;
	success: boolean;
	command: string;

	public constructor(request: DebugProtocol.Request, message?: string) {
		super('response');
		this.request_seq = request.seq;
		this.command = request.command;
		if (message) {
			this.success = false;
			(<any>this).message = message;
		} else {
			this.success = true;
		}
	}
}

export class Event extends Message implements DebugProtocol.Event {
	event: string;

	public constructor(event: string, body?: any) {
		super('event');
		this.event = event;
		if (body) {
			(<any>this).body = body;
		}
	}
}

export class V8Protocol extends ee.EventEmitter {

	private static TIMEOUT = 3000;

	private _state: string;
	private _contentLength: number;
	private _bodyStartByteIndex: number;
	private _res: any;
	private _sequence: number;
	private _writableStream: NodeJS.WritableStream;
	private _pendingRequests = new Map<number, DebugProtocol.Response>();

	constructor() {
		super();
	}

	protected start(inStream: NodeJS.ReadableStream, outStream: NodeJS.WritableStream): void {
		this._sequence = 1;
		this._writableStream = outStream;
		this._newRes(null);

		inStream.setEncoding('utf8');

		inStream.on('data', (data) => this._handleData(data));
		inStream.on('close', () => {
			this._emitEvent(new Event('close'));
		});
		inStream.on('error', (error) => {
			this._emitEvent(new Event('error'));
		});

		outStream.on('error', (error) => {
			this._emitEvent(new Event('error'));
		});

		inStream.resume();
	}

	public stop(): void {
		if (this._writableStream) {
			this._writableStream.end();
		}
	}

	protected send(command: string, args: any, timeout: number = V8Protocol.TIMEOUT): Promise<DebugProtocol.Response> {
		return new Promise((completeDispatch, errorDispatch) => {
			this._sendRequest(command, args, timeout, (result: DebugProtocol.Response) => {
				if (result.success) {
					completeDispatch(result);
				} else {
					errorDispatch(result);
				}
			});
		});
	}

	public sendEvent(event: DebugProtocol.Event): void {
		this._send('event', event);
	}

	public sendResponse(response: DebugProtocol.Response): void {
		if (response.seq > 0) {
			console.error('attempt to send more than one response for command {0}', response.command);
		} else {
			this._send('response', response);
		}
	}

	// ---- protected ----------------------------------------------------------

	protected dispatchRequest(request: DebugProtocol.Request): void {
	}

	// ---- private ------------------------------------------------------------

	private _sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void {

		const request: any = {
			command: command
		};
		if (args && Object.keys(args).length > 0) {
			request.arguments = args;
		}

		this._send('request', request);

		if (cb) {
			this._pendingRequests[request.seq] = cb;

			const timer = setTimeout(() => {
				clearTimeout(timer);
				const clb = this._pendingRequests[request.seq];
				if (clb) {
					delete this._pendingRequests[request.seq];
					clb(new Response(request, 'timeout after ' + timeout + 'ms'));

					this._emitEvent(new Event('diagnostic', { reason: 'unresponsive ' + command }));
				}
			}, timeout);
		}
	}

	private _emitEvent(event: DebugProtocol.Event) {
		this.emit(event.event, event);
	}

	private _send(typ: string, message: DebugProtocol.V8Message): void {
		message.type = typ;
		message.seq = this._sequence++;
		const json = JSON.stringify(message);
		const data = 'Content-Length: ' + Buffer.byteLength(json, 'utf8') + '\r\n\r\n' + json;
		if (this._writableStream) {
			this._writableStream.write(data);
		}
	}

	private _newRes(raw: string): void {
		this._res = {
			raw: raw || '',
			headers: {}
		};
		this._state = 'headers';
		this._handleData('');
	}

	private _handleData(d): void {
		const res = this._res;
		res.raw += d;

		switch (this._state) {
			case 'headers':
				const endHeaderIndex = res.raw.indexOf('\r\n\r\n');
				if (endHeaderIndex < 0)
					break;

				const rawHeader = res.raw.slice(0, endHeaderIndex);
				const endHeaderByteIndex = Buffer.byteLength(rawHeader, 'utf8');
				const lines = rawHeader.split('\r\n');
				for (let i = 0; i < lines.length; i++) {
					const kv = lines[i].split(/: +/);
					res.headers[kv[0]] = kv[1];
				}

				this._contentLength = +res.headers['Content-Length'];
				this._bodyStartByteIndex = endHeaderByteIndex + 4;

				this._state = 'body';

				const len = Buffer.byteLength(res.raw, 'utf8');
				if (len - this._bodyStartByteIndex < this._contentLength) {
					break;
				}
			// pass thru

			case 'body':
				const resRawByteLength = Buffer.byteLength(res.raw, 'utf8');
				if (resRawByteLength - this._bodyStartByteIndex >= this._contentLength) {
					const buf = new Buffer(resRawByteLength);
					buf.write(res.raw, 0, resRawByteLength, 'utf8');
					res.body = buf.slice(this._bodyStartByteIndex, this._bodyStartByteIndex + this._contentLength).toString('utf8');
					res.body = res.body.length ? JSON.parse(res.body) : {};
					this._dispatch(res.body);
					this._newRes(buf.slice(this._bodyStartByteIndex + this._contentLength).toString('utf8'));
				}
				break;

			default:
				throw new Error('Unknown state');
				break;
		}
	}

	private _dispatch(message: DebugProtocol.V8Message): void {
		switch (message.type) {
		case 'event':
			this._emitEvent(<DebugProtocol.Event> message);
			break;
		case 'response':
			const response = <DebugProtocol.Response> message;
			const clb = this._pendingRequests[response.request_seq];
			if (clb) {
				delete this._pendingRequests[response.request_seq];
				clb(response);
			}
			break;
		case 'request':
			this.dispatchRequest(<DebugProtocol.Request> message);
			break;
		default:
			break;
		}
	}
}
