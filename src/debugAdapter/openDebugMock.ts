/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, Thread, StackFrame, Scope, Source} from './common/debugSession';
import {Handles} from './common/Handles';
import {readFileSync} from 'fs';
import {basename, dirname} from 'path';
import {spawn, ChildProcess} from 'child_process';
import {Client, RPCConnection} from 'json-rpc2';

interface DebuggerState {
	exited: boolean;
	exitStatus: number;
	breakPoint: {
		addr: number;
		continue: boolean;
		file: string;
		functionName: string;
		goroutine: boolean;
		id: number;
		line: number;
		stacktrace: number;
	}
	breakPointInfo: {};
	currentThread: {
		file: string;
		id: number;
		line: number;
		pc: number;
	};
	currentGoroutine: {
		file: string;
		function: {
			args: {};
			goType: number;
			locals: {};
			name: string;
			type: number;
			value: number;
		};
		id: number;
		line: number;
		pc: number;
	};
}

interface DebuggerCommand {
	name: string;
}

class Delve {
	debugProcess: ChildProcess;
	connection: Promise<RPCConnection>;
	
	constructor(program: string) {
		this.connection = new Promise((resolve, reject) => {
			var serverRunning = false;
			this.debugProcess = spawn('/Users/lukeh/dd/go/bin/dlv', ['debug',  '--headless=true', '--listen=127.0.0.1:2345', '--log', program], { cwd: dirname(program) });
			
			function connectClient() {
				var client = Client.$create(2345, '127.0.0.1');
				client.connectSocket((err, conn) => {
					if (err) return reject(err);
					resolve(conn);			
				});
			}
			
			this.debugProcess.stderr.on('data', chunk => {
				var str = chunk.toString();
				console.log(str);
				if(!serverRunning) {
					serverRunning = true;
					connectClient();
				}
			});
			this.debugProcess.stdout.on('data', function(chunk) {
				var str = chunk.toString();
				console.log(str);
			});
			this.debugProcess.on('close', function(code) {
				throw new Error(code);
			});
		});
	}
	
	call<T>(command: string, args: any[], callback: (err: Error, results: T) => void) {
		this.connection.then(conn => {
			conn.call('RPCServer.' + command, args, callback);
		}, err => {
			callback(err, null);
		});
	}
}

class MockDebugSession extends DebugSession {

	private _sourceFile: string;
	private _currentLine: number;
	private _sourceLines: string[];
	private _breakPoints: any;
	private _variableHandles: Handles<string>;
	
	private debugState: DebuggerState;
	private debugProcess: ChildProcess;
	private delve: Delve;

	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
		this._sourceFile = null;
		this._sourceLines = [];
		this._currentLine = 0;
		this._breakPoints = {};
		this._variableHandles = new Handles<string>();
	}

	protected initializeRequest(response: OpenDebugProtocol.InitializeResponse, args: OpenDebugProtocol.InitializeRequestArguments): void {
		console.log("initializeRequest");
		// give UI a chance to set breakpoints
		this.sendResponse(response);
		this.sendEvent(new InitializedEvent());
	}

	protected launchRequest(response: OpenDebugProtocol.LaunchResponse, args: OpenDebugProtocol.LaunchRequestArguments): void {
		this._sourceFile = args.program;
		this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');
		
		this.delve = new Delve(args.program);
		
		this.delve.call('ProcessPid', [], (err, result) =>{
			if(err) return console.log("ERROR: "+ err);
			console.log("RESULT: " + result);
			// if (args.stopOnEntry) {
			// 	this._currentLine = 0;
				this.sendResponse(response);
				this.sendEvent(new StoppedEvent("entry", 4711));
			// } else {
			// 	this.continueRequest(response);
			// }
		});
	}

	protected setBreakPointsRequest(response: OpenDebugProtocol.SetBreakpointsResponse, args: OpenDebugProtocol.SetBreakpointsArguments): void {
		var breakpoints = [];
		for(var i = 0; i < args.lines.length; i++) {
			var line = args.lines[i];
			var file = args.source.path;
			this.delve.call('CreateBreakpoint', [{file, line}], (err, result) => { 
				if(result) {
					breakpoints.push({
						verified: true,
						line: (<any>result).line
					})
				} else {
					breakpoints.push({
						verified: true,
						line: args.lines[i]
					})
				}
				if(breakpoints.length == args.lines.length) {
					response.body = { breakpoints };
					this.sendResponse(response);
				}
			});		
		}
	}

	protected threadsRequest(response: OpenDebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [
				new Thread(4711, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: OpenDebugProtocol.StackTraceResponse, args: OpenDebugProtocol.StackTraceArguments): void {

		var frames = new Array<StackFrame>();
		
		frames.push(new StackFrame(
			this.debugState.breakPoint.stacktrace, 
			this.debugState.breakPoint.functionName, 
			new Source(basename(this._sourceFile), 
			this.convertDebuggerPathToClient(this._sourceFile)), 
			this.convertDebuggerLineToClient(this._currentLine), 
			0)
		);
		
		response.body = {
			stackFrames: frames
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: OpenDebugProtocol.ScopesResponse, args: OpenDebugProtocol.ScopesArguments): void {

		const frameReference = args.frameId;
		//const frame = this._frameHandles.get(frameReference);
		//const frameIx = frame.index;
		//const frameThis = this.getValueFromCache(frame.receiver);
		var i = frameReference;

		var scopes = new Array<Scope>();

		scopes.push(new Scope("Local", this._variableHandles.create("local_" + i), false));
		scopes.push(new Scope("Closure", this._variableHandles.create("closure_" + i), false));
		scopes.push(new Scope("Global", this._variableHandles.create("global_" + i), true));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: OpenDebugProtocol.VariablesResponse, args: OpenDebugProtocol.VariablesArguments): void {
		var variables = [];
		var id = this._variableHandles.get(args.variablesReference);
		if (id != null) {
			variables.push({
				name: id + "_i",
				value: "123",
				variablesReference: 0
			});
			variables.push({
				name: id + "_f",
				value: "3.14",
				variablesReference: 0
			});
			variables.push({
				name: id + "_s",
				value: "hello world",
				variablesReference: 0
			});
			variables.push({
				name: id + "_o",
				value: "Object",
				variablesReference: this._variableHandles.create("object_")
			});
		}

		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: OpenDebugProtocol.ContinueResponse): void {
		this.delve.call<DebuggerState>('Command', [{ name: 'continue' }], (err, result) => {
			console.log(result);
			if(result.exited) {
				this.sendEvent(new TerminatedEvent());	
			} else {
				this._sourceFile = result.breakPoint.file;
				this._currentLine = result.breakPoint.line;
				this.debugState = result;
				this.sendEvent(new StoppedEvent("breakpoint", 4711));
			}
		});
		this.sendResponse(response);
	}

	protected nextRequest(response: OpenDebugProtocol.NextResponse): void {
		for (var ln = this._currentLine+1; ln < this._sourceLines.length; ln++) {
			if (this._sourceLines[ln].trim().length > 0) {   // find next non-empty line
				this._currentLine = ln;
				this.sendResponse(response);
				this.sendEvent(new StoppedEvent("step", 4711));
				return;
			}
		}
		this.sendResponse(response);
		// no more lines: run to end
		this.sendEvent(new TerminatedEvent());
	}

	protected evaluateRequest(response: OpenDebugProtocol.EvaluateResponse, args: OpenDebugProtocol.EvaluateArguments): void {
		response.body = { result: "evaluate(" + args.expression + ")", variablesReference: 0 };
		this.sendResponse(response);
	}
}

DebugSession.run(MockDebugSession);
