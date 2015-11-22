/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source} from './common/debugSession';
import {Handles} from './common/handles';
import {readFileSync, existsSync, lstatSync} from 'fs';
import {basename, dirname} from 'path';
import {spawn, ChildProcess} from 'child_process';
import {Client, RPCConnection} from 'json-rpc2';
import * as path from 'path';
import {getBinPath} from '../goPath';

// These types should stay in sync with:
// https://github.com/derekparker/delve/blob/master/service/api/types.go

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
	addr: number;
	type: string;
	realType: string;
	kind: number;
	value: string;
	len: number;
	cap: number;
	children: DebugVariable[];
	unreadable: string;
}

interface DebugGoroutine {
	id: number;
	currentLoc: DebugLocation;
	userCurrentLoc: DebugLocation;
	goStatementLoc: DebugLocation;
}

interface DebuggerCommand {
	name: string;
	threadID?: number;
	goroutineID?: number;
}

// This interface should always match the schema found in `package.json`.
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	program: string;
	stopOnEntry?: boolean;
	args?: string[];
	cwd?: string;
	env?: { [key: string]: string; },
	mode?: string;
	buildFlags?: string;
	init?: string;
}

class Delve {
	debugProcess: ChildProcess;
	connection: Promise<RPCConnection>;
	onstdout: (str: string) => void;
	onstderr: (str: string) => void;

	constructor(mode: string, program: string, args: string[], cwd: string, env: { [key: string]: string }, buildFlags: string, init: string) {
		this.connection = new Promise((resolve, reject) => {
			var serverRunning = false;
			var dlv = getBinPath("dlv");
			console.log("Using dlv at: ", dlv)
			if (!existsSync(dlv)) {
				return reject("Cannot find Delve debugger.  Run 'go get -u github.com/derekparker/delve/cmd/dlv' to install.")
			}
			var dlvEnv: Object = null;
			if (env) {
				dlvEnv = {};
				for (var k in process.env) {
					dlvEnv[k] = process.env[k];
				}
				for (var k in env) {
					dlvEnv[k] = env[k];
				}
			}
			var dlvArgs = [mode || "debug"];
			if (mode == "exec") {
				dlvArgs = dlvArgs.concat([program]);
			}
			dlvArgs = dlvArgs.concat(['--headless=true', '--listen=127.0.0.1:2345', '--log']);
			if (buildFlags) {
				dlvArgs = dlvArgs.concat(['--build-flags=' + buildFlags]);
			}
			if (init) {
				dlvArgs = dlvArgs.concat(['--init=' + init]);
			}
			if (args) {
				dlvArgs = dlvArgs.concat(['--', ...args]);
			}

			var dlvCwd = dirname(program);
			try {
				if (lstatSync(program).isDirectory()) {
					dlvCwd = program;
				}
			} catch (e) { }
			this.debugProcess = spawn(dlv, dlvArgs, {
				cwd: dlvCwd,
				env: dlvEnv,
			});

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
				if (this.onstderr) { this.onstderr(str); }
				if (!serverRunning) {
					serverRunning = true;
					connectClient();
				}
			});
			this.debugProcess.stdout.on('data', chunk => {
				var str = chunk.toString();
				console.log(str);
				if (this.onstdout) { this.onstdout(str); }
			});
			this.debugProcess.on('close', function(code) {
				//TODO: Report `dlv` crash to user. 
				console.error("Process exiting with code: " + code);
			});
			this.debugProcess.on('error', function(err) {
				reject(err);
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

	callPromise<T>(command: string, args: any[]): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.connection.then(conn => {
				conn.call<T>('RPCServer.' + command, args, (err, res) => {
					if (err) return reject(err);
					resolve(res);
				});
			}, err => {
				reject(err);
			});
		});
	}

	close() {
		this.debugProcess.kill();
	}
}

class GoDebugSession extends DebugSession {

	private _variableHandles: Handles<string>;
	private breakpoints: Map<string, DebugBreakpoint[]>;
	private debugState: DebuggerState;
	private delve: Delve;

	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
		this._variableHandles = new Handles<string>();
		this.debugState = null;
		this.delve = null;
		this.breakpoints = new Map<string, DebugBreakpoint[]>();
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		console.log("InitializeRequest");
		this.sendResponse(response);
		console.log("InitializeResponse")
		this.sendEvent(new InitializedEvent());
		console.log("InitializeEvent");
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		// Launch the Delve debugger on the program
		this.delve = new Delve(args.mode, args.program, args.args, args.cwd, args.env, args.buildFlags, args.init);
		this.delve.onstdout = (str: string) => {
			this.sendEvent(new OutputEvent(str, 'stdout'));
		};
		this.delve.onstderr = (str: string) => {
			this.sendEvent(new OutputEvent(str, 'stderr'));
		};

		// TODO: This isn't quite right - may not want to blindly continue on start.
		this.continueRequest(response);
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		console.log("DisconnectRequest");
		this.delve.close();
		super.disconnectRequest(response, args);
		console.log("DisconnectResponse");
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		console.log("SetBreakPointsRequest")
		if (!this.breakpoints.get(args.source.path)) {
			this.breakpoints.set(args.source.path, []);
		}
		var file = args.source.path;
		var existingBPs = this.breakpoints.get(file);
		Promise.all(this.breakpoints.get(file).map(existingBP => {
			console.log("Clearing: " + existingBP.id);
			return this.delve.callPromise<DebugBreakpoint>('ClearBreakpoint', [existingBP.id])
		})).then(() => {
			console.log("All cleared")
			return Promise.all(args.lines.map(line => {
				console.log("Creating on: " + file + ":" + line);
				return this.delve.callPromise<DebugBreakpoint>('CreateBreakpoint', [{ file, line }]).catch(err => null);
			}))
		}).then(newBreakpoints => {
			console.log("All set:" + JSON.stringify(newBreakpoints));
			var breakpoints = newBreakpoints.map((bp, i) => {
				if (bp) {
					return { verified: true, line: bp.line }
				} else {
					return { verified: false, line: args.lines[i] }
				}
			});
			this.breakpoints.set(args.source.path, newBreakpoints.filter(x => !!x));
			return breakpoints;
		}).then(breakpoints => {
			response.body = { breakpoints };
			this.sendResponse(response);
			console.log("SetBreakPointsResponse")
		}, err => {
			this.sendErrorResponse(response, 2002, "Failed to set breakpoint: '{e}'", { e: err.toString() })
			console.error(err);
		});
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		console.log("ThreadsRequest")
		this.delve.call<DebugGoroutine[]>('ListGoroutines', [], (err, goroutines) => {
			if (err) {
				console.error("Failed to get threads.")
				return this.sendErrorResponse(response, 2003, "Unable to display threads: '{e}'", { e: err.toString() });
			}
			var threads = goroutines.map(goroutine =>
				new Thread(
					goroutine.id,
					goroutine.currentLoc.function ? goroutine.currentLoc.function.name : (goroutine.currentLoc.file + "@" + goroutine.currentLoc.line)
				)
			);
			response.body = { threads };
			this.sendResponse(response);
			console.log("ThreadsResponse")
			console.log(threads);
		});
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		console.log("StackTraceRequest")
		this.delve.call<DebugLocation[]>('StacktraceGoroutine', [{ id: args.threadId, depth: args.levels }], (err, locations) => {
			if (err) {
				console.error("Failed to produce stack trace!")
				return this.sendErrorResponse(response, 2004, "Unable to produce stack trace: '{e}'", { e: err.toString() });
			}
			console.log(locations);
			var stackFrames = locations.map((location, i) =>
				new StackFrame(
					i,
					location.function ? location.function.name : "<unknown>",
					new Source(
						basename(location.file),
						this.convertDebuggerPathToClient(location.file)
					),
					location.line,
					0
				)
			);
			response.body = { stackFrames };
			this.sendResponse(response);
			console.log("StackTraceResponse");
		});
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		console.log("ScopesRequest")
		var scopes = new Array<Scope>();
		// Locals includes both locals and arguments
		scopes.push(new Scope("Local", this._variableHandles.create("local_" + args.frameId), false));
		// TODO: Let user see package vars and thread local package vars.
		//       The former in particular is a very large set of variables.
		//scopes.push(new Scope("Thread", this._variableHandles.create("threadpackage_" + args.frameId), false));
		//scopes.push(new Scope("Package", this._variableHandles.create("package_" + args.frameId), false));
		response.body = { scopes };
		this.sendResponse(response);
		console.log("ScopesResponse")
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		console.log("VariablesRequest");
		var req = this._variableHandles.get(args.variablesReference);
		var parts = req.split('_');
		var kind = parts[0];
		var frame = +parts[1];
		switch (kind) {
			case "local":
				this.delve.call<DebugVariable[]>('ListLocalVars', [{ goroutineID: this.debugState.currentGoroutine.id, frame: frame }], (err, locals) => {
					if (err) {
						console.error("Failed to list local variables.")
						return this.sendErrorResponse(response, 2005, "Unable to list locals: '{e}'", { e: err.toString() });
					}
					console.log(locals);
					this.delve.call<DebugVariable[]>('ListFunctionArgs', [{ goroutineID: this.debugState.currentGoroutine.id, frame: frame }], (err, args) => {
						if (err) {
							console.error("Failed to list function args.")
							return this.sendErrorResponse(response, 2006, "Unable to list args: '{e}'", { e: err.toString() });
						}
						console.log(args);
						var vars = args.concat(locals);
						for (var i = 2; i < parts.length; i++) {
							vars = vars[+parts[i]].children;
						}
						var variables = vars.map((v, i) => {
							return {
								name: v.name,
								value: v.value || v.type,
								variablesReference: v.children.length > 0 ? this._variableHandles.create(req + "_" + i) : 0
							}
						});
						console.log(JSON.stringify(variables, null, ' '))

						response.body = { variables };
						this.sendResponse(response);
						console.log("VariablesResponse");
					});
				});
				break;
			// case "package":
			// 	this.delve.call<DebugVariable[]>('ListPackageVars', [{ goroutineID: this.debugState.currentGoroutine.id, frame: frame }], (err, vars) => {	
			// 		console.log(vars);
			// 		var variables = vars.map((v, i) => ({ 
			// 			name: v.name,
			// 			value: v.value,
			// 			variablesReference: 0
			// 		}));
			// 		response.body = { variables };
			// 		this.sendResponse(response);	
			// 		console.log("VariablesResponse");			
			// 	});
			// 	break;
			default:
				console.error("Unknown variable request: " + kind);
				response.body = { variables: [] };
				this.sendResponse(response);
				console.log("VariablesResponse");
		}
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse): void {
		console.log("ContinueRequest")
		this.delve.call<DebuggerState>('Command', [{ name: 'continue' }], (err, state) => {
			if (err) {
				console.error("Failed to continue.")
			}
			console.log(state);
			if (state.exited) {
				this.sendEvent(new TerminatedEvent());
				console.log("TerminatedEvent");
			} else {
				this.debugState = state;
				this.sendEvent(new StoppedEvent("breakpoint", this.debugState.currentGoroutine.id));
				console.log("StoppedEvent('breakpoint')");
			}
		});
		this.sendResponse(response);
		console.log("ContinueResponse");
	}

	protected nextRequest(response: DebugProtocol.NextResponse): void {
		console.log("NextRequest")
		this.delve.call<DebuggerState>('Command', [{ name: 'next' }], (err, state) => {
			if (err) {
				console.error("Failed to next.")
			}
			console.log(state);
			if (state.exited) {
				this.sendEvent(new TerminatedEvent());
				console.log("TerminatedEvent");
			} else {
				this.debugState = state;
				this.sendEvent(new StoppedEvent("step", this.debugState.currentGoroutine.id));
				console.log("StoppedEvent('step')");
			}
		});
		this.sendResponse(response);
		console.log("NextResponse")
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse): void {
		console.log("StepInRequest")
		this.delve.call<DebuggerState>('Command', [{ name: 'step' }], (err, state) => {
			if (err) {
				console.error("Failed to step.")
			}
			console.log(state);
			if (state.exited) {
				this.sendEvent(new TerminatedEvent());
				console.log("TerminatedEvent");
			} else {
				this.debugState = state;
				this.sendEvent(new StoppedEvent("step", this.debugState.currentGoroutine.id));
				console.log("StoppedEvent('step')");
			}
		});
		this.sendResponse(response);
		console.log("StepInResponse")
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
		console.error('Not yet implemented: stepOutRequest');
		this.sendErrorResponse(response, 2000, "Step out is not yet supported");
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse): void {
		console.error('Not yet implemented: pauseRequest');
		this.sendErrorResponse(response, 2000, "Pause is not yet supported");
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		console.log("EvaluateRequest");
		var evalSymbolArgs = {
			symbol: args.expression,
			scope: {
				goroutineID: this.debugState.currentGoroutine.id,
				frame: args.frameId
			}
		};
		this.delve.call<DebugVariable>('EvalSymbol', [evalSymbolArgs], (err, variable) => {
			if (err) {
				console.error("Failed to eval expression: ", JSON.stringify(evalSymbolArgs, null, ' '));
				return this.sendErrorResponse(response, 2009, "Unable to eval expression: '{e}'", { e: err.toString() });
			}
			response.body = { result: variable.value, variablesReference: 0 };
			this.sendResponse(response);
			console.log("EvaluateResponse");
		});
	}
}

DebugSession.run(GoDebugSession);
