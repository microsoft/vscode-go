/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {V8Protocol, Response, Event} from './v8Protocol';
import * as Net from 'net';


export class Source implements DebugProtocol.Source {
	name: string;
	path: string;
	sourceReference: number;

	public constructor(name: string, path: string, id: number = 0) {
		this.name = name;
		this.path = path;
		this.sourceReference = id;
	}
}

export class Scope implements DebugProtocol.Scope {
	name: string;
	variablesReference: number;
	expensive: boolean;

	public constructor(name: string, reference: number, expensive: boolean = false) {
		this.name = name;
		this.variablesReference = reference;
		this.expensive = expensive;
	}
}

export class StackFrame implements DebugProtocol.StackFrame {
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

export class Thread implements DebugProtocol.Thread {
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

export class Variable implements DebugProtocol.Variable {
	name: string;
	value: string;
	variablesReference: number;

	public constructor(name: string, value: string, ref: number = 0) {
		this.name = name;
		this.value = value;
		this.variablesReference = ref;
	}
}

export class Breakpoint implements DebugProtocol.Breakpoint {
	verified: boolean;
	line: number;

	public constructor(verified: boolean, line: number) {
		this.verified = verified;
		this.line = line;
	}
}

export class StoppedEvent extends Event implements DebugProtocol.StoppedEvent {
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

export class InitializedEvent extends Event implements DebugProtocol.InitializedEvent {
	public constructor() {
		super('initialized');
	}
}

export class TerminatedEvent extends Event implements DebugProtocol.TerminatedEvent {
	public constructor() {
		super('terminated');
	}
}

export class OutputEvent extends Event implements DebugProtocol.OutputEvent {
	body: {
		category: string,
		output: string
	};

	public constructor(output: string, category: string = 'console') {
		super('output');
		this.body = {
			category: category,
			output: output
		};
	}
}

export enum ErrorDestination {
	User = 1,
	Telemetry = 2
};

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
				new debugSession(false, true).start(socket, socket);
			}).listen(port);
		} else {

			// start a session
			console.error("waiting for v8 protocol on stdin/stdout");
			let session = new debugSession(false);
			process.on('SIGTERM', () => {
				session.shutdown();
			});
			session.start(process.stdin, process.stdout);
		}
	}

	public shutdown(): void {
		if (this._isServer) {
			console.error('process.exit ignored in server mode');
		} else {
			// wait a bit before shutting down
			setTimeout(() => {
				process.exit(0);
			}, 100);
		}
	}

	protected sendErrorResponse(response: DebugProtocol.Response, code: number, format: string, args?: any, dest: ErrorDestination = ErrorDestination.User): void {

		const message = formatPII(format, true, args);

		response.success = false;
		response.message = `${response.command}: ${message}`;
		if (!response.body) {
			response.body = {};
		}
		const msg = <DebugProtocol.Message> {
			id: code,
			format: format
		};
		if (args) {
			msg.variables = args;
		}
		if (dest & ErrorDestination.User) {
			msg.showUser = true;
		}
		if (dest & ErrorDestination.Telemetry) {
			msg.sendTelemetry = true;
		}
		response.body.error = msg;

		this.sendResponse(response);
	}

	protected dispatchRequest(request: DebugProtocol.Request): void {

		const response = new Response(request);

		try {
			if (request.command === 'initialize') {
				var args = <DebugProtocol.InitializeRequestArguments> request.arguments;
				this._clientLinesStartAt1 = args.linesStartAt1;
				this._clientPathFormat = args.pathFormat;
				this.initializeRequest(<DebugProtocol.InitializeResponse> response, args);

			} else if (request.command === 'launch') {
				this.launchRequest(<DebugProtocol.LaunchResponse> response, request.arguments);

			} else if (request.command === 'attach') {
				this.attachRequest(<DebugProtocol.AttachResponse> response, request.arguments);

			} else if (request.command === 'disconnect') {
				this.disconnectRequest(<DebugProtocol.DisconnectResponse> response, request.arguments);

			} else if (request.command === 'setBreakpoints') {
				this.setBreakPointsRequest(<DebugProtocol.SetBreakpointsResponse> response, request.arguments);

			} else if (request.command === 'setExceptionBreakpoints') {
				this.setExceptionBreakPointsRequest(<DebugProtocol.SetExceptionBreakpointsResponse> response, request.arguments);

			} else if (request.command === 'continue') {
				this.continueRequest(<DebugProtocol.ContinueResponse> response, request.arguments);

			} else if (request.command === 'next') {
				this.nextRequest(<DebugProtocol.NextResponse> response, request.arguments);

			} else if (request.command === 'stepIn') {
				this.stepInRequest(<DebugProtocol.StepInResponse> response, request.arguments);

			} else if (request.command === 'stepOut') {
				this.stepOutRequest(<DebugProtocol.StepOutResponse> response, request.arguments);

			} else if (request.command === 'pause') {
				this.pauseRequest(<DebugProtocol.PauseResponse> response, request.arguments);

			} else if (request.command === 'stackTrace') {
				this.stackTraceRequest(<DebugProtocol.StackTraceResponse> response, request.arguments);

			} else if (request.command === 'scopes') {
				this.scopesRequest(<DebugProtocol.ScopesResponse> response, request.arguments);

			} else if (request.command === 'variables') {
				this.variablesRequest(<DebugProtocol.VariablesResponse> response, request.arguments);

			} else if (request.command === 'source') {
				this.sourceRequest(<DebugProtocol.SourceResponse> response, request.arguments);

			} else if (request.command === 'threads') {
				this.threadsRequest(<DebugProtocol.ThreadsResponse> response);

			} else if (request.command === 'evaluate') {
				this.evaluateRequest(<DebugProtocol.EvaluateResponse> response, request.arguments);

			} else {
				this.sendErrorResponse(response, 1014, "unrecognized request", null, ErrorDestination.Telemetry);
			}
		} catch (e) {
			this.sendErrorResponse(response, 1104, "exception while processing request (exception: {_exception})", { _exception: e.message }, ErrorDestination.Telemetry);
		}
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		this.sendResponse(response);
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		this.sendResponse(response);
		this.shutdown();
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments): void {
		this.sendResponse(response);
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments): void {
		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		this.sendResponse(response);
	}

	protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) : void {
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) : void {
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) : void {
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments) : void {
		this.sendResponse(response);
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments) : void {
		this.sendResponse(response);
	}

	protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments) : void {
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		this.sendResponse(response);
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
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

/*
 * If argument starts with '_' it is OK to send its value to telemetry.
 */
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
