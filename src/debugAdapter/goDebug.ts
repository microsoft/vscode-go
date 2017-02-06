/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import { DebugProtocol } from 'vscode-debugprotocol';
import { DebugSession, InitializedEvent, TerminatedEvent, ThreadEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { readFileSync, existsSync, lstatSync } from 'fs';
import { basename, dirname } from 'path';
import { spawn, ChildProcess, execSync, spawnSync } from 'child_process';
import { Client, RPCConnection } from 'json-rpc2';
import { getBinPathWithPreferredGopath, resolvePath } from '../goPath';
import * as logger from 'vscode-debug-logger';

require('console-stamp')(console);

// This enum should stay in sync with https://golang.org/pkg/reflect/#Kind

enum GoReflectKind {
	Invalid = 0,
	Bool,
	Int,
	Int8,
	Int16,
	Int32,
	Int64,
	Uint,
	Uint8,
	Uint16,
	Uint32,
	Uint64,
	Uintptr,
	Float32,
	Float64,
	Complex64,
	Complex128,
	Array,
	Chan,
	Func,
	Interface,
	Map,
	Ptr,
	Slice,
	String,
	Struct,
	UnsafePointer
}

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
	kind: GoReflectKind;
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
	showLog?: boolean;
	cwd?: string;
	env?: { [key: string]: string; };
	mode?: string;
	remotePath?: string;
	port?: number;
	host?: string;
	buildFlags?: string;
	init?: string;
	trace?: boolean|'verbose';
}

process.on('uncaughtException', (err: any) => {
	const errMessage = err && (err.stack || err.message);
	logger.error(`Unhandled error in debug adapter: ${errMessage}`);
	throw err;
});

function logArgsToString(args: any[]): string {
	return args.map(arg => {
		return typeof arg === 'string' ?
			arg :
			JSON.stringify(arg);
	}).join(' ');
}

function verbose(...args: any[]) {
	logger.verbose(logArgsToString(args));
}

function log(...args: any[]) {
	logger.log(logArgsToString(args));
}

function logError(...args: any[]) {
	logger.error(logArgsToString(args));
}

class Delve {
	program: string;
	remotePath: string;
	debugProcess: ChildProcess;
	connection: Promise<RPCConnection>;
	onstdout: (str: string) => void;
	onstderr: (str: string) => void;
	onclose: () => void;

	constructor(mode: string, remotePath: string, port: number, host: string, program: string, args: string[], showLog: boolean, cwd: string, env: { [key: string]: string }, buildFlags: string, init: string) {
		this.program = program;
		this.remotePath = remotePath;
		this.connection = new Promise((resolve, reject) => {
			if (!program) {
				return reject('The program attribute is missing in launch.json');
			}
			let serverRunning = false;
			if (mode === 'remote') {
				this.debugProcess = null;
				serverRunning = true;  // assume server is running when in remote mode
				connectClient(port, host);
				return;
			}

			if (!env) env = {};

			let dlv = getBinPathWithPreferredGopath('dlv', resolvePath(env['GOPATH']));

			if (!existsSync(dlv)) {
				verbose(`Couldnt find dlv at ${process.env['GOPATH']}${env['GOPATH'] ? ', ' + env['GOPATH'] : ''} or ${process.env['PATH']}`);
				return reject(`Cannot find Delve debugger. Ensure it is in your "GOPATH/bin" or "PATH".`);
			}
			verbose('Using dlv at: ' + dlv);

			let dlvEnv: Object = null;
			if (env) {
				dlvEnv = {};
				for (let k in process.env) {
					dlvEnv[k] = process.env[k];
				}
				for (let k in env) {
					dlvEnv[k] = env[k];
				}
			}
			let dlvArgs = [mode || 'debug'];
			if (mode === 'exec') {
				dlvArgs = dlvArgs.concat([program]);
			}
			dlvArgs = dlvArgs.concat(['--headless=true', '--listen=' + host + ':' + port.toString()]);
			if (showLog) {
				dlvArgs = dlvArgs.concat(['--log=' + showLog.toString()]);
			}
			if (cwd) {
				dlvArgs = dlvArgs.concat(['--wd=' + cwd]);
			}
			if (buildFlags) {
				dlvArgs = dlvArgs.concat(['--build-flags=' + buildFlags]);
			}
			if (init) {
				dlvArgs = dlvArgs.concat(['--init=' + init]);
			}
			if (args) {
				dlvArgs = dlvArgs.concat(['--', ...args]);
			}

			let dlvCwd = dirname(program);
			try {
				if (lstatSync(program).isDirectory()) {
					dlvCwd = program;
				}
			} catch (e) { }
			this.debugProcess = spawn(dlv, dlvArgs, {
				cwd: dlvCwd,
				env: dlvEnv,
			});

			function connectClient(port: number, host: string) {
				// Add a slight delay to avoid issues on Linux with
				// Delve failing calls made shortly after connection.
				setTimeout(() => {
					let client = Client.$create(port, host);
					client.connectSocket((err, conn) => {
						if (err) return reject(err);
						return resolve(conn);
					});
				}, 200);
			}

			this.debugProcess.stderr.on('data', chunk => {
				let str = chunk.toString();
				if (this.onstderr) { this.onstderr(str); }
				if (!serverRunning) {
					serverRunning = true;
					connectClient(port, host);
				}
			});
			this.debugProcess.stdout.on('data', chunk => {
				let str = chunk.toString();
				if (this.onstdout) { this.onstdout(str); }
				if (!serverRunning) {
					serverRunning = true;
					connectClient(port, host);
				}
			});
			this.debugProcess.on('close', (code) => {
				// TODO: Report `dlv` crash to user.
				logError('Process exiting with code: ' + code);
				if (code !== 0 && this.onclose) { this.onclose(); }
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

	callPromise<T>(command: string, args: any[]): Thenable<T> {
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
		if (!this.debugProcess) {
			this.call<DebuggerState>('Command', [{ name: 'halt' }], (err, state) => {
				if (err) return logError('Failed to halt.');
				this.call<DebuggerState>('Restart', [], (err, state) => {
					if (err) return logError('Failed to restart.');
				});
			});
		} else {
			killTree(this.debugProcess.pid);
		}
	}
}

class GoDebugSession extends DebugSession {

	private _variableHandles: Handles<DebugVariable>;
	private breakpoints: Map<string, DebugBreakpoint[]>;
	private threads: Set<number>;
	private debugState: DebuggerState;
	private delve: Delve;
	private localPathSeparator: string;
	private remotePathSeparator: string;

	private launchArgs: LaunchRequestArguments;

	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
		super(debuggerLinesStartAt1, isServer);
		this._variableHandles = new Handles<DebugVariable>();
		this.threads = new Set<number>();
		this.debugState = null;
		this.delve = null;
		this.breakpoints = new Map<string, DebugBreakpoint[]>();

		const logPath = path.join(os.tmpdir(), 'vscode-go-debug.txt');
		logger.init(e => this.sendEvent(e), logPath, isServer);
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		verbose('InitializeRequest');
		// This debug adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;
		this.sendResponse(response);
		verbose('InitializeResponse');
	}

	protected findPathSeperator(path) {
		if (/^(\w:[\\/]|\\\\)/.test(path)) return '\\';
		return path.includes('/') ? '/' : '\\';
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
		this.launchArgs = args;
		const logLevel = args.trace === 'verbose' ?
			logger.LogLevel.Verbose :
			args.trace ? logger.LogLevel.Log :
				logger.LogLevel.Error;
		logger.setMinLogLevel(logLevel);

		// Launch the Delve debugger on the program
		let localPath = args.program;
		let remotePath = args.remotePath || '';
		let port = args.port || random(2000, 50000);
		let host = args.host || '127.0.0.1';

		if (remotePath.length > 0) {
			this.localPathSeparator = this.findPathSeperator(localPath);
			this.remotePathSeparator = this.findPathSeperator(remotePath);

			let llist = localPath.split(/\/|\\/).reverse();
			let rlist = remotePath.split(/\/|\\/).reverse();
			let i = 0;
			for (; i < llist.length; i++) if (llist[i] !== rlist[i]) break;

			if (i) {
				localPath = llist.reverse().slice(0, -i).join(this.localPathSeparator);
				remotePath = rlist.reverse().slice(0, -i).join(this.remotePathSeparator);
			} else if ((remotePath.endsWith('\\')) || (remotePath.endsWith('/'))) {
				remotePath = remotePath.substring(0, remotePath.length - 1);
			}
		}

		this.delve = new Delve(args.mode, remotePath, port, host, localPath, args.args, args.showLog, args.cwd, args.env, args.buildFlags, args.init);
		this.delve.onstdout = (str: string) => {
			this.sendEvent(new OutputEvent(str, 'stdout'));
		};
		this.delve.onstderr = (str: string) => {
			this.sendEvent(new OutputEvent(str, 'stderr'));
		};
		this.delve.onclose = () => {
			this.sendErrorResponse(response, 3000, 'Failed to continue: Check the debug console for details.');
			verbose('Delve is closed');
		};

		this.delve.connection.then(() => {
			this.sendEvent(new InitializedEvent());
			verbose('InitializeEvent');
			this.sendResponse(response);
		}, err => {
			this.sendErrorResponse(response, 3000, 'Failed to continue: "{e}"', { e: err.toString() });
			verbose('ContinueResponse');
		});
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		verbose('DisconnectRequest');
		this.delve.close();
		super.disconnectRequest(response, args);
		verbose('DisconnectResponse');
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		verbose('ConfigurationDoneRequest');

		if (this.launchArgs.stopOnEntry) {
			this.sendEvent(new StoppedEvent('breakpoint', 0));
			verbose('StoppedEvent("breakpoint")');
			this.sendResponse(response);
		} else {
			this.continueRequest(<DebugProtocol.ContinueResponse>response);
		}
	}

	protected toDebuggerPath(path: string): string {
		if (this.delve.remotePath.length === 0) {
			return this.convertClientPathToDebugger(path);
		}
		return path.replace(this.delve.program, this.delve.remotePath).split(this.localPathSeparator).join(this.remotePathSeparator);
	}

	protected toLocalPath(path: string): string {
		if (this.delve.remotePath.length === 0) {
			return this.convertDebuggerPathToClient(path);
		}
		return path.replace(this.delve.remotePath, this.delve.program).split(this.remotePathSeparator).join(this.localPathSeparator);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		verbose('SetBreakPointsRequest');
		if (!this.breakpoints.get(args.source.path)) {
			this.breakpoints.set(args.source.path, []);
		}
		let file = args.source.path;
		let remoteFile = this.toDebuggerPath(file);
		let existingBPs = this.breakpoints.get(file);
		Promise.all(this.breakpoints.get(file).map(existingBP => {
			verbose('Clearing: ' + existingBP.id);
			return this.delve.callPromise<DebugBreakpoint>('ClearBreakpoint', [existingBP.id]);
		})).then(() => {
			verbose('All cleared');
			return Promise.all(args.lines.map(line => {
				if (this.delve.remotePath.length === 0) {
					verbose('Creating on: ' + file + ':' + line);
				} else {
					verbose('Creating on: ' + file + ' (' + remoteFile + ') :' + line);
				}
				return this.delve.callPromise<DebugBreakpoint>('CreateBreakpoint', [{ file: remoteFile, line }]).then(null, err => {
					verbose('Error on CreateBreakpoint');
					return null;
				});
			}));
		}).then(newBreakpoints => {
			verbose('All set:' + JSON.stringify(newBreakpoints));
			let breakpoints = newBreakpoints.map((bp, i) => {
				if (bp) {
					return { verified: true, line: bp.line };
				} else {
					return { verified: false, line: args.lines[i] };
				}
			});
			this.breakpoints.set(args.source.path, newBreakpoints.filter(x => !!x));
			return breakpoints;
		}).then(breakpoints => {
			response.body = { breakpoints };
			this.sendResponse(response);
			verbose('SetBreakPointsResponse');
		}, err => {
			this.sendErrorResponse(response, 2002, 'Failed to set breakpoint: "{e}"', { e: err.toString() });
			logError(err);
		});
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		verbose('ThreadsRequest');
		this.delve.call<DebugGoroutine[]>('ListGoroutines', [], (err, goroutines) => {
			if (this.debugState.exited) {
				// If the program exits very quickly, the initial threadsRequest will complete after it has exited.
				// A TerminatedEvent has already been sent. Ignore the err returned in this case.
				response.body = { threads: [] };
				return this.sendResponse(response);
			}

			if (err) {
				logError('Failed to get threads.');
				return this.sendErrorResponse(response, 2003, 'Unable to display threads: "{e}"', { e: err.toString() });
			}
			verbose('goroutines', goroutines);
			let threads = goroutines.map(goroutine =>
				new Thread(
					goroutine.id,
					goroutine.userCurrentLoc.function ? goroutine.userCurrentLoc.function.name : (goroutine.userCurrentLoc.file + '@' + goroutine.userCurrentLoc.line)
				)
			);
			response.body = { threads };
			this.sendResponse(response);
			verbose('ThreadsResponse', threads);
		});
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		verbose('StackTraceRequest');
		this.delve.call<DebugLocation[]>('StacktraceGoroutine', [{ id: args.threadId, depth: args.levels }], (err, locations) => {
			if (err) {
				logError('Failed to produce stack trace!');
				return this.sendErrorResponse(response, 2004, 'Unable to produce stack trace: "{e}"', { e: err.toString() });
			}
			verbose('locations', locations);
			let stackFrames = locations.map((location, i) =>
				new StackFrame(
					i,
					location.function ? location.function.name : '<unknown>',
					new Source(
						basename(location.file),
						this.toLocalPath(location.file)
					),
					location.line,
					0
				)
			);
			response.body = { stackFrames };
			this.sendResponse(response);
			verbose('StackTraceResponse');
		});
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		verbose('ScopesRequest');
		this.delve.call<DebugVariable[]>('ListLocalVars', [{ goroutineID: this.debugState.currentGoroutine.id, frame: args.frameId }], (err, locals) => {
			if (err) {
				logError('Failed to list local variables.');
				return this.sendErrorResponse(response, 2005, 'Unable to list locals: "{e}"', { e: err.toString() });
			}
			verbose('locals', locals);
			this.delve.call<DebugVariable[]>('ListFunctionArgs', [{ goroutineID: this.debugState.currentGoroutine.id, frame: args.frameId }], (err, args) => {
				if (err) {
					logError('Failed to list function args.');
					return this.sendErrorResponse(response, 2006, 'Unable to list args: "{e}"', { e: err.toString() });
				}
				verbose('functionArgs', args);
				let vars = args.concat(locals);

				let scopes = new Array<Scope>();
				let localVariables = {
					name: 'Local',
					addr: 0,
					type: '',
					realType: '',
					kind: 0,
					value: '',
					len: 0,
					cap: 0,
					children: vars,
					unreadable: ''
				};
				scopes.push(new Scope('Local', this._variableHandles.create(localVariables), false));
				response.body = { scopes };
				this.sendResponse(response);
				verbose('ScopesResponse');
			});
		});
	}

	private convertDebugVariableToProtocolVariable(v: DebugVariable, i: number): { result: string; variablesReference: number; } {
		if (v.kind === GoReflectKind.UnsafePointer) {
			return {
				result: `unsafe.Pointer(0x${v.children[0].addr.toString(16)})`,
				variablesReference: 0
			};
		} else if (v.kind === GoReflectKind.Ptr) {
			if (v.children[0].addr === 0) {
				return {
					result: 'nil <' + v.type + '>',
					variablesReference: 0
				};
			} else if (v.children[0].type === 'void') {
				return {
					result: 'void',
					variablesReference: 0
				};
			} else {
				return {
					result: '<' + v.type + '>',
					variablesReference: v.children[0].children.length > 0 ? this._variableHandles.create(v.children[0]) : 0
				};
			}
		} else if (v.kind === GoReflectKind.Slice) {
			return {
				result: '<' + v.type + '> (length: ' + v.len + ', cap: ' + v.cap + ')',
				variablesReference: this._variableHandles.create(v)
			};
		} else if (v.kind === GoReflectKind.Array) {
			return {
				result: '<' + v.type + '>',
				variablesReference: this._variableHandles.create(v)
			};
		} else if (v.kind === GoReflectKind.String) {
			let val = v.value;
			if (v.value && v.value.length < v.len) {
				val += `...+${v.len - v.value.length} more`;
			}
			return {
				result: v.unreadable ? ('<' + v.unreadable + '>') : ('"' + val + '"'),
				variablesReference: 0
			};
		} else {
			return {
				result: v.value || ('<' + v.type + '>'),
				variablesReference: v.children.length > 0 ? this._variableHandles.create(v) : 0
			};
		}
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		verbose('VariablesRequest');
		let vari = this._variableHandles.get(args.variablesReference);
		let variables;
		if (vari.kind === GoReflectKind.Array || vari.kind === GoReflectKind.Slice || vari.kind === GoReflectKind.Map) {
			variables = vari.children.map((v, i) => {
				let { result, variablesReference} = this.convertDebugVariableToProtocolVariable(v, i);
				return {
					name: '[' + i + ']',
					value: result,
					variablesReference
				};
			});
		} else {
			variables = vari.children.map((v, i) => {
				let { result, variablesReference} = this.convertDebugVariableToProtocolVariable(v, i);
				return {
					name: v.name,
					value: result,
					variablesReference
				};
			});
		}
		response.body = { variables };
		this.sendResponse(response);
		verbose('VariablesResponse', JSON.stringify(variables, null, ' '));
	}

	private handleReenterDebug(reason: string): void {
		if (this.debugState.exited) {
			this.sendEvent(new TerminatedEvent());
			verbose('TerminatedEvent');
		} else {
			// [TODO] Can we avoid doing this? https://github.com/Microsoft/vscode/issues/40#issuecomment-161999881
			this.delve.call<DebugGoroutine[]>('ListGoroutines', [], (err, goroutines) => {
				if (err) {
					logError('Failed to get threads.');
				}
				// Assume we need to stop all the threads we saw before...
				let needsToBeStopped = new Set<number>();
				this.threads.forEach(id => needsToBeStopped.add(id));
				for (let goroutine of goroutines) {
					// ...but delete from list of threads to stop if we still see it
					needsToBeStopped.delete(goroutine.id);
					if (!this.threads.has(goroutine.id)) {
						// Send started event if it's new
						this.sendEvent(new ThreadEvent('started', goroutine.id));
					}
					this.threads.add(goroutine.id);
				}
				// Send existed event if it's no longer there
				needsToBeStopped.forEach(id => {
					this.sendEvent(new ThreadEvent('exited', id));
					this.threads.delete(id);
				});

				let stoppedEvent = new StoppedEvent(reason, this.debugState.currentGoroutine.id);
				(<any>stoppedEvent.body).allThreadsStopped = true;
				this.sendEvent(stoppedEvent);
				verbose('StoppedEvent("' + reason + '")');
			});
		}
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse): void {
		verbose('ContinueRequest');
		this.delve.call<DebuggerState>('Command', [{ name: 'continue' }], (err, state) => {
			if (err) {
				logError('Failed to continue.');
			}
			verbose('state', state);
			this.debugState = state;
			this.handleReenterDebug('breakpoint');
		});
		this.sendResponse(response);
		verbose('ContinueResponse');
	}

	protected nextRequest(response: DebugProtocol.NextResponse): void {
		verbose('NextRequest');
		this.delve.call<DebuggerState>('Command', [{ name: 'next' }], (err, state) => {
			if (err) {
				logError('Failed to next.');
			}
			verbose('state', state);
			this.debugState = state;
			this.handleReenterDebug('step');
		});
		this.sendResponse(response);
		verbose('NextResponse');
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse): void {
		verbose('StepInRequest');
		this.delve.call<DebuggerState>('Command', [{ name: 'step' }], (err, state) => {
			if (err) {
				logError('Failed to step.');
			}
			verbose('state', state);
			this.debugState = state;
			this.handleReenterDebug('step');
		});
		this.sendResponse(response);
		verbose('StepInResponse');
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
		verbose('StepOutRequest');
		this.delve.call<DebuggerState>('Command', [{ name: 'stepOut' }], (err, state) => {
			if (err) {
				logError('Failed to stepout.');
			}
			verbose('state', state);
			this.debugState = state;
			this.handleReenterDebug('step');
		});
		this.sendResponse(response);
		verbose('StepOutResponse');
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse): void {
		verbose('PauseRequest');
		this.delve.call<DebuggerState>('Command', [{ name: 'halt' }], (err, state) => {
			if (err) {
				logError('Failed to halt.');
				return this.sendErrorResponse(response, 2010, 'Unable to halt execution: "{e}"', { e: err.toString() });
			}
			verbose('state', state);
			this.sendResponse(response);
			verbose('PauseResponse');
		});
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		verbose('EvaluateRequest');
		let evalSymbolArgs = {
			symbol: args.expression,
			scope: {
				goroutineID: this.debugState.currentGoroutine.id,
				frame: args.frameId
			}
		};
		this.delve.call<DebugVariable>('EvalSymbol', [evalSymbolArgs], (err, variable) => {
			if (err) {
				logError('Failed to eval expression: ', JSON.stringify(evalSymbolArgs, null, ' '));
				return this.sendErrorResponse(response, 2009, 'Unable to eval expression: "{e}"', { e: err.toString() });
			}
			response.body = this.convertDebugVariableToProtocolVariable(variable, 0);
			this.sendResponse(response);
			verbose('EvaluateResponse');
		});
	}
}

function random(low: number, high: number): number {
	return Math.floor(Math.random() * (high - low) + low);
}

function killTree(processId: number): void {
	if (process.platform === 'win32') {
		const TASK_KILL = 'C:\\Windows\\System32\\taskkill.exe';

		// when killing a process in Windows its child processes are *not* killed but become root processes.
		// Therefore we use TASKKILL.EXE
		try {
			execSync(`${TASK_KILL} /F /T /PID ${processId}`);
		} catch (err) {
		}
	} else {
		// on linux and OS X we kill all direct and indirect child processes as well
		try {
			const cmd = path.join(__dirname, '../../../scripts/terminateProcess.sh');
			spawnSync(cmd, [ processId.toString() ]);
		} catch (err) {
		}
	}
}

DebugSession.run(GoDebugSession);
