/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {V8Protocol, Response, Event} from './v8Protocol';
import * as Net from 'net';


export class Source implements OpenDebugProtocol.Source {
	name: string;
	path: string;
	sourceReference: number;

	public constructor(name: string, path: string, id: number = 0) {
		this.name = name;
		this.path = path;
		this.sourceReference = id;
	}
}

export class Scope implements OpenDebugProtocol.Scope {
	name: string;
	variablesReference: number;
	expensive: boolean;

	public constructor(name: string, reference: number, expensive: boolean = false) {
		this.name = name;
		this.variablesReference = reference;
		this.expensive = expensive;
	}
}

export class StackFrame implements OpenDebugProtocol.StackFrame {
	id: number;
	source: Source;
	line: number;
	column: number;
	name: string;

	public constructor(i: number, nm: string, src: Source, ln: number, col: number) {
		this.id = i;
		this.source = src;
		this.line = ln;
		this.column = col;
		this.name = nm;
	}
}

export class Thread implements OpenDebugProtocol.Thread {
	id: number;
	name: string;

	public constructor(id: number, name: string) {
		this.id = id;
		if (name) {
			this.name = name;
		} else {
			this.name = "Thread #" + id;
		}
	}
}

export class Variable implements OpenDebugProtocol.Variable {
	name: string;
	value: string;
	variablesReference: number;

	public constructor(name: string, value: string, ref: number = 0) {
		this.name = name;
		this.value = value;
		this.variablesReference = ref;
	}
}

export class Breakpoint implements OpenDebugProtocol.Breakpoint {
	verified: boolean;
	line: number;

	public constructor(verified: boolean, line: number) {
		this.verified = verified;
		this.line = line;
	}
}

export class StoppedEvent extends Event implements OpenDebugProtocol.StoppedEvent {
	body: {
		reason: string;
		threadId: number;
	};

	public constructor(reason: string, threadId: number, exception_text: string = null) {
		super('stopped');
		this.body = {
			reason: reason,
			threadId: threadId
		};

		if (exception_text) {
			(<any>this).body.text = exception_text;
		}
	}
}

export class InitializedEvent extends Event implements OpenDebugProtocol.InitializedEvent {
	public constructor() {
		super('initialized');
	}
}

export class TerminatedEvent extends Event implements OpenDebugProtocol.TerminatedEvent {
	public constructor() {
		super('terminated');
	}
}


export class DebugSession extends V8Protocol {

	private _debuggerLinesStartAt1: boolean;

	private _clientLinesStartAt1: boolean;
	private _clientPathFormat: string;
	private _isServer: boolean;

	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super();
		this._debuggerLinesStartAt1 = debuggerLinesStartAt1;
		this._isServer = isServer;

		this.on('close', () => {
			this.shutdown();
		});
		this.on('error', (error) => {
			this.shutdown();
		});
	}

	/**
	 * A virtual constructor...
	 */
	public static run(debugSession: typeof DebugSession) {

		// parse arguments
		let port = 0;
		const args = process.argv.slice(2);
		args.forEach(function (val, index, array) {
			const portMatch = /^--server=(\d{4,5})$/.exec(val);
			if (portMatch) {
				port = parseInt(portMatch[1], 10);
			}
		});

		if (port > 0) {
			// start as a server
			console.error(`waiting for v8 protocol on port ${port}`);
			Net.createServer((socket) => {
				console.error('>> accepted connection from client');
				socket.on('end', () => {
					console.error('>> client connection closed\n');
				});
				//new MockDebugSession(false, true).startDispatch(socket, socket);
				new debugSession(false, true).startDispatch(socket, socket);
			}).listen(port);
		} else {

			// start a session
			console.error("waiting for v8 protocol on stdin/stdout");
			let session = new debugSession(false);
			//let session = new MockDebugSession(false);
			process.on('SIGTERM', () => {
				session.shutdown();
			});
			session.startDispatch(process.stdin, process.stdout);
		}
	}

	public shutdown(): void {
		if (this._isServer) {
			console.error('process.exit ignored in server mode');
		} else {
			process.exit(0);
		}
	}

	protected sendErrorResponse(response: OpenDebugProtocol.Response, format: string, ...params: any[]): void {
		response.success = false;
		const args = [ `${response.command}: ${format}` ].concat(params);
		response.message = formatPII.apply(null, args);
		this.sendResponse(response);
	}

	protected sendFErrorResponse(response: OpenDebugProtocol.Response, code: number, format: string, args?: any): void {

		const message = formatPII(format, true, args);

		response.success = false;
		response.message = `${response.command}: ${message}`;
		if (!response.body) {
			response.body = {};
		}
		response.body.error = <OpenDebugProtocol.Message> {
			id: code,
			format: format,
			variables: args
		};
		this.sendResponse(response);
	}

	protected dispatchRequest(request: OpenDebugProtocol.Request): void {

		const response = new Response(request);

		try {
			if (request.command === 'initialize') {
				var args = <OpenDebugProtocol.InitializeRequestArguments> request.arguments;
				this._clientLinesStartAt1 = args.linesStartAt1;
				this._clientPathFormat = args.pathFormat;
				this.initializeRequest(<OpenDebugProtocol.InitializeResponse> response, args);

			} else if (request.command === 'launch') {
				this.launchRequest(<OpenDebugProtocol.LaunchResponse> response, <OpenDebugProtocol.LaunchRequestArguments> request.arguments);

			} else if (request.command === 'attach') {
				this.attachRequest(<OpenDebugProtocol.AttachResponse> response, <OpenDebugProtocol.AttachRequestArguments> request.arguments);

			} else if (request.command === 'disconnect') {
				this.disconnectRequest(<OpenDebugProtocol.DisconnectResponse> response);

			} else if (request.command === 'setBreakpoints') {
				this.setBreakPointsRequest(<OpenDebugProtocol.SetBreakpointsResponse> response, <OpenDebugProtocol.SetBreakpointsArguments> request.arguments);

			} else if (request.command === 'setExceptionBreakpoints') {
				this.setExceptionBreakPointsRequest(<OpenDebugProtocol.SetExceptionBreakpointsResponse> response, <OpenDebugProtocol.SetExceptionBreakpointsArguments> request.arguments);

			} else if (request.command === 'continue') {
				this.continueRequest(<OpenDebugProtocol.ContinueResponse> response);

			} else if (request.command === 'next') {
				this.nextRequest(<OpenDebugProtocol.NextResponse> response);

			} else if (request.command === 'stepIn') {
				this.stepInRequest(<OpenDebugProtocol.StepInResponse> response);

			} else if (request.command === 'stepOut') {
				this.stepOutRequest(<OpenDebugProtocol.StepOutResponse> response);

			} else if (request.command === 'pause') {
				this.pauseRequest(<OpenDebugProtocol.PauseResponse> response);

			} else if (request.command === 'stackTrace') {
				this.stackTraceRequest(<OpenDebugProtocol.StackTraceResponse> response, <OpenDebugProtocol.StackTraceArguments> request.arguments);

			} else if (request.command === 'scopes') {
				this.scopesRequest(<OpenDebugProtocol.ScopesResponse> response, <OpenDebugProtocol.ScopesArguments> request.arguments);

			} else if (request.command === 'variables') {
				this.variablesRequest(<OpenDebugProtocol.VariablesResponse> response, <OpenDebugProtocol.VariablesArguments> request.arguments);

			} else if (request.command === 'source') {
				this.sourceRequest(<OpenDebugProtocol.SourceResponse> response, <OpenDebugProtocol.SourceArguments> request.arguments);

			} else if (request.command === 'threads') {
				this.threadsRequest(<OpenDebugProtocol.ThreadsResponse> response);

			} else if (request.command === 'evaluate') {
				this.evaluateRequest(<OpenDebugProtocol.EvaluateResponse> response, <OpenDebugProtocol.EvaluateArguments> request.arguments);

			} else {
				this.sendErrorResponse(response, "unhandled request");
			}
		} catch (e) {
			this.sendErrorResponse(response, "exception: {0}", e);
		}
	}

	protected initializeRequest(response: OpenDebugProtocol.InitializeResponse, args: OpenDebugProtocol.InitializeRequestArguments): void {
		this.sendResponse(response);
	}

	protected disconnectRequest(response: OpenDebugProtocol.DisconnectResponse): void {
		this.sendResponse(response);
		this.shutdown();
	}

	protected launchRequest(response: OpenDebugProtocol.LaunchResponse, args: OpenDebugProtocol.LaunchRequestArguments): void {
		this.sendResponse(response);
	}

	protected attachRequest(response: OpenDebugProtocol.AttachResponse, args: OpenDebugProtocol.AttachRequestArguments): void {
		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: OpenDebugProtocol.SetBreakpointsResponse, args: OpenDebugProtocol.SetBreakpointsArguments): void {
		this.sendResponse(response);
	}

	protected setExceptionBreakPointsRequest(response: OpenDebugProtocol.SetExceptionBreakpointsResponse, args: OpenDebugProtocol.SetExceptionBreakpointsArguments): void {
		this.sendResponse(response);
	}

	protected continueRequest(response: OpenDebugProtocol.ContinueResponse) : void {
		this.sendResponse(response);
	}

	protected nextRequest(response: OpenDebugProtocol.NextResponse) : void {
		this.sendResponse(response);
	}

	protected stepInRequest(response: OpenDebugProtocol.StepInResponse) : void {
		this.sendResponse(response);
	}

	protected stepOutRequest(response: OpenDebugProtocol.StepOutResponse) : void {
		this.sendResponse(response);
	}

	protected pauseRequest(response: OpenDebugProtocol.PauseResponse) : void {
		this.sendResponse(response);
	}

	protected sourceRequest(response: OpenDebugProtocol.SourceResponse, args: OpenDebugProtocol.SourceArguments) : void {
		this.sendResponse(response);
	}

	protected threadsRequest(response: OpenDebugProtocol.ThreadsResponse): void {
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: OpenDebugProtocol.StackTraceResponse, args: OpenDebugProtocol.StackTraceArguments): void {
		this.sendResponse(response);
	}

	protected scopesRequest(response: OpenDebugProtocol.ScopesResponse, args: OpenDebugProtocol.ScopesArguments): void {
		this.sendResponse(response);
	}

	protected variablesRequest(response: OpenDebugProtocol.VariablesResponse, args: OpenDebugProtocol.VariablesArguments): void {
		this.sendResponse(response);
	}

	protected evaluateRequest(response: OpenDebugProtocol.EvaluateResponse, args: OpenDebugProtocol.EvaluateArguments): void {
		this.sendResponse(response);
	}

	//-----------------------------------------------------------------------------------------------------

	protected convertClientLineToDebugger(line): number {
		if (this._debuggerLinesStartAt1) {
			return this._clientLinesStartAt1 ? line : line + 1;
		}
		return this._clientLinesStartAt1 ? line - 1 : line;
	}

	protected convertDebuggerLineToClient(line): number {
		if (this._debuggerLinesStartAt1) {
			return this._clientLinesStartAt1 ? line : line - 1;
		}
		return this._clientLinesStartAt1 ? line + 1 : line;
	}

	protected convertDebuggerColumnToClient(column): number {
		// TODO@AW
		return column;
	}

	protected convertClientPathToDebugger(path: string): string {
		// TODO@AW
		return path;
	}

	protected convertDebuggerPathToClient(path: string): string {
		// TODO@AW
		return path;
	}
}

const _formatPIIRegexp = /{([^}]+)}/g;

function formatPII(format:string, excludePII: boolean, args: {[key: string]: string}): string {
	return format.replace(_formatPIIRegexp, function(match, paramName) {
		if (excludePII && paramName.length > 0 && paramName[0] !== '_') {
			return match;
		}
		return args[paramName] && args.hasOwnProperty(paramName) ?
			args[paramName] :
			match;
	})
}
