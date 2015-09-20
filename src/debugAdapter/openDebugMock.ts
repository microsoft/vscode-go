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
	breakPoint: DebugBreakpoint;
	breakPointInfo: {};
	currentThread: DebugThread;
	currentGoroutine: DebugGoroutine;
}

interface DebugBreakpoint {
	addr: number;
	continue: boolean;
	file: string;
	functionName?: string;
	goroutine: boolean;
	id: number;
	line: number;
	stacktrace: number;
	variables?: DebugVariable[];
}

interface DebugThread {
	file: string;
	id: number;
	line: number;
	pc: number;
	function?: DebugFunction;
};

interface DebugLocation {
	pc: number;
	file: string;
	line: number;
	function: DebugFunction;
}

interface DebugFunction {
	name: string;
	value: number;
	type: number;
	goType: number;
	args: DebugVariable[];
	locals: DebugVariable[];
}

interface DebugVariable {
	name: string;
	value: string;
	type: string;
}

interface DebugGoroutine {
	id: number;
	pc: number;
	file: string;
	line: number;
	function: DebugFunction;
}

interface DebuggerCommand {
	name: string;
	threadID?: number;
	goroutineID?: number;
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
		
		this.delve.call<DebuggerState>('State', [], (err, result) =>{
			if(err) return console.log("ERROR: "+ err);
			console.log("RESULT: " + result);
			this.debugState = result;
			this.sendResponse(response);
			this.sendEvent(new StoppedEvent("entry", 4711));
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
		this.delve.call<DebugGoroutine[]>('ListGoroutines', [], (err, goroutines) => {
			var threads = goroutines.map(goroutine =>
				new Thread(
					goroutine.id, 
					goroutine.function ? goroutine.function.name : (goroutine.file + "@" + goroutine.line)
				)
			);
			response.body = { threads };
			this.sendResponse(response);
		});
	}

	protected stackTraceRequest(response: OpenDebugProtocol.StackTraceResponse, args: OpenDebugProtocol.StackTraceArguments): void {
		this.delve.call<DebugLocation[]>('StacktraceGoroutine', [{ id: 1, depth: args.levels }], (err, locations) => {
			// if(err) {
			// 	// This happens on entry...
			// 	console.log("Stack trace failed");
			// 	response.body = {
			// 		stackFrames: []
			// 	}
			// 	// this.sendResponse(response);
			// 	// return;
			// }
			console.log(locations);
			var stackFrames = locations.map((location, i) => 
				new StackFrame(
					i,
					location.function ? location.function.name : "<unknown>",
					new Source(
						basename(location.file),
						this.convertDebuggerPathToClient(location.file)
					),
					this.convertDebuggerLineToClient(location.line),
					0
				)
			);
			response.body = { stackFrames };
			this.sendResponse(response);				
		});
	}

	protected scopesRequest(response: OpenDebugProtocol.ScopesResponse, args: OpenDebugProtocol.ScopesArguments): void {
		const frameReference = args.frameId;
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
		this.delve.call<DebugVariable[]>('ListLocalVars', [{ goroutineID: 1, frame: 0 }], (err, vars) => {	
			console.log(vars);
			var variables = vars.map((v, i) => ({ 
				name: v.name,
				value: v.value,
				variablesReference: 0
			}));
			response.body = { variables };
			this.sendResponse(response);				
		});
	}

	protected continueRequest(response: OpenDebugProtocol.ContinueResponse): void {
		this.delve.call<DebuggerState>('Command', [{ name: 'continue' }], (err, state) => {
			console.log(state);
			if(state.exited) {
				this.sendEvent(new TerminatedEvent());	
			} else {
				this._sourceFile = state.breakPoint.file;
				this._currentLine = state.breakPoint.line;
				this.debugState = state;
				this.sendEvent(new StoppedEvent("breakpoint", 4711));
			}
		});
		this.sendResponse(response);
	}

	protected nextRequest(response: OpenDebugProtocol.NextResponse): void {
		this.delve.call<DebuggerState>('Command', [{ name: 'next' }], (err, state) => {
			console.log(state);
			if(state.exited) {
				this.sendEvent(new TerminatedEvent());	
			} else {
				this._sourceFile = state.breakPoint.file;
				this._currentLine = state.breakPoint.line;
				this.debugState = state;
				this.sendEvent(new StoppedEvent("step", 4711));
			}
		});
		this.sendResponse(response);
		
		// for (var ln = this._currentLine+1; ln < this._sourceLines.length; ln++) {
		// 	if (this._sourceLines[ln].trim().length > 0) {   // find next non-empty line
		// 		this._currentLine = ln;
		// 		this.sendResponse(response);
		// 		this.sendEvent(new StoppedEvent("step", 4711));
		// 		return;
		// 	}
		// }
		// this.sendResponse(response);
		// // no more lines: run to end
		// this.sendEvent(new TerminatedEvent());
	}

	protected evaluateRequest(response: OpenDebugProtocol.EvaluateResponse, args: OpenDebugProtocol.EvaluateArguments): void {
		response.body = { result: "evaluate(" + args.expression + ")", variablesReference: 0 };
		this.sendResponse(response);
	}
}

DebugSession.run(MockDebugSession);
