/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as EE from 'events';

export class Message implements OpenDebugProtocol.V8Message {
	seq: number;
	type: string;

	public constructor(type: string) {
		this.seq = 0;
		this.type = type;
	}
}

export class Response extends Message implements OpenDebugProtocol.Response {
	request_seq: number;
	success: boolean;
	command: string;

	public constructor(request: OpenDebugProtocol.Request, message?: string) {
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

export class Event extends Message implements OpenDebugProtocol.Event {
	event: string;

	public constructor(event: string, body?: any) {
		super('event');
		this.event = event;
		if (body) {
			(<any>this).body = body;
		}
	}
}

export class V8Protocol extends EE.EventEmitter {

	private static TIMEOUT = 3000;

	private _state: string;
	private _contentLength: number;
	private _bodyStartByteIndex: number;
	private _res: any;
	private _sequence: number;
	private _writableStream: NodeJS.WritableStream;
	private _pendingRequests = new Map<number, OpenDebugProtocol.Response>();
	private _unresponsiveMode: boolean;

	public embeddedHostVersion: number = -1;


	public startDispatch(inStream: NodeJS.ReadableStream, outStream: NodeJS.WritableStream): void {
		this._sequence = 1;
		this._writableStream = outStream;
		this._newRes(null);

		inStream.setEncoding('utf8');

		inStream.on('data', (data) => this.execute(data));
		inStream.on('close', () => {
			this.emitEvent(new Event('close'));
		});
		inStream.on('error', (error) => {
			this.emitEvent(new Event('error'));
		});

		outStream.on('error', (error) => {
			this.emitEvent(new Event('error'));
		});

		inStream.resume();
	}

	public stop(): void {
		if (this._writableStream) {
			this._writableStream.end();
		}
	}

	public command(command: string, args?: any, cb?: (response: OpenDebugProtocol.Response) => void): void {

		const timeout = V8Protocol.TIMEOUT;

		const request: any = {
			command: command
		};
		if (args && Object.keys(args).length > 0) {
			request.arguments = args;
		}

		if (this._unresponsiveMode) {
			if (cb) {
				cb(new Response(request, 'cancelled because node is unresponsive'));
			}
			return;
		}

		this.send('request', request);

		if (cb) {
			this._pendingRequests[request.seq] = cb;

			const timer = setTimeout(() => {
				clearTimeout(timer);
				const clb = this._pendingRequests[request.seq];
				if (clb) {
					delete this._pendingRequests[request.seq];
					clb(new Response(request, 'timeout after ' + timeout + 'ms'));

					this._unresponsiveMode = true;
					this.emitEvent(new Event('diagnostic', { reason: 'unresponsive ' + command }));
				}
			}, timeout);
		}
	}

	public command2(command: string, args: any, timeout: number = V8Protocol.TIMEOUT): Promise<OpenDebugProtocol.Response> {
		return new Promise((completeDispatch, errorDispatch) => {
			this.command(command, args, (result: OpenDebugProtocol.Response) => {
				if (result.success) {
					completeDispatch(result);
				} else {
					errorDispatch(result);
				}
			});
		});
	}

	public sendEvent(event: OpenDebugProtocol.Event): void {
		this.send('event', event);
	}

	public sendResponse(response: OpenDebugProtocol.Response): void {
		if (response.seq > 0) {
			console.error('attempt to send more than one response for command {0}', response.command);
		} else {
			this.send('response', response);
		}
	}

	// ---- protected ----------------------------------------------------------

	protected dispatchRequest(request: OpenDebugProtocol.Request): void {
	}

	// ---- private ------------------------------------------------------------

	private emitEvent(event: OpenDebugProtocol.Event) {
		this.emit(event.event, event);
	}

	private send(typ: string, message: OpenDebugProtocol.V8Message): void {
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
		this.execute('');
	}

	private internalDispatch(message: OpenDebugProtocol.V8Message): void {
		switch (message.type) {
		case 'event':
			const e = <OpenDebugProtocol.Event> message;
			this.emitEvent(e);
			break;
		case 'response':
			if (this._unresponsiveMode) {
				this._unresponsiveMode = false;
				this.emitEvent(new Event('diagnostic', { reason: 'responsive' }));
			}
			const response = <OpenDebugProtocol.Response> message;
			const clb = this._pendingRequests[response.request_seq];
			if (clb) {
				delete this._pendingRequests[response.request_seq];
				clb(response);
			}
			break;
		case 'request':
			this.dispatchRequest(<OpenDebugProtocol.Request> message);
			break;
		default:
			break;
		}
	}

	private execute(d): void {
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
					if (kv[0] === 'Embedding-Host') {
						const match = kv[1].match(/node\sv(\d+)\.\d+\.\d+/)
						if (match.length === 2) {
							this.embeddedHostVersion = parseInt(match[1]);
						}
					}
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
					this.internalDispatch(res.body);
					this._newRes(buf.slice(this._bodyStartByteIndex + this._contentLength).toString('utf8'));
				}
				break;

			default:
				throw new Error('Unknown state');
				break;
		}
	}
}
