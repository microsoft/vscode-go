## Install delve

There are 2 ways to install delve
- Run the command `Go: Install/Update Tools`, select `dlv`, press `Ok` to install/update delve
- Or install it manually install delve as per the [Installation Instructions](https://github.com/go-delve/delve/tree/master/Documentation/installation).

## Set up configurations in your settings

The below settings are used by the debugger. You may not need to add/change any of them to have debugging working in simple cases, but do give them a read sometime
- `go.gopath`. See [GOPATH in VS Code](GOPATH-in-the-VS-Code-Go-extension.md)
- `go.inferGopath`. See [GOPATH in VS Code](GOPATH-in-the-VS-Code-Go-extension.md)
- `go.delveConfig`
     - `apiVersion`: Controls the version of delve apis to be used when launching the delve headless server. Default is 2.
     - `dlvLoadConfig`: Not applicable when `apiVersion` is 1. The configuration passed to delve. Controls [various features of delve](https://github.com/Microsoft/vscode-go/blob/0.6.85/package.json#L431-L468) that affects the variables shown in the debug pane.
         - `maxStringLen`:  maximum number of bytes read from a string
         - `maxArrayValues`:  maximum number of elements read from an array, a slice or a map
         - `maxStructFields`:  maximum number of fields read from a struct, -1 will read all fields
         - `maxVariableRecurse`:  how far to recurse when evaluating nested types
         - `followPointers`:  requests pointers to be automatically dereferenced         
     

Some common cases where you might want to tweak the configurations passed to delve
- Change the default cap of 64 on string and array length when inspecting variables in the debug viewlet.
- Evaluate variables that are nested when inspecting them in the debug viewlet.

## Set up configurations in launch.json

Once delve is installed, run the command `Debug: Open launch.json`. If you didnt already have a launch.json file, this will create one with the below default configuration which can be used to debug the current package.

```json
{
	"version": "0.2.0",
	"configurations": [
		{
			"name": "Launch",
			"type": "go",
			"request": "launch",
			"mode": "auto",
			"program": "${fileDirname}",
			"env": {},
			"args": []
		}
	]
}
```


Below is some more information on some common properties you can tweak in the debug configuration:

Property | Description
------- | ------
name | Name for your configuration that appears in the drop down in the Debug viewlet
type | Always set to "go". This is used by VS Code to figure out which extension should be used for debugging your code
request | Either of `launch` or `attach`. Use `attach` when you want to attach to an already running process.
mode | For launch requests, either of `auto`, `debug`, `remote`, `test`, `exec`. For attach requests, use either `local` or `remote`
program | Absolute path to the package or file to debug when in `debug` & `test` mode, or to the pre-built binary file to debug in `exec` mode. Not applicable to attach requests.
env | Environment variables to use when debugging. Example: `{ "ENVNAME": "ENVVALUE" }`
envFile | Absolute path to a file containing environment variable definitions. The environment variables passed in the `env` property overrides the ones in this file.
args | Array of command line arguments that will be passed to the program being debugged. 
showLog | Boolean indicating if logs from delve should be printed in the debug console
logOutput | Comma separated list of delve components (`debugger`, `gdbwire`, `lldbout`, `debuglineerr`, `rpc`) that should produce debug output when `showLog` is set to `true`.
buildFlags | Build flags to be passed to the Go compiler
remotePath | Absolute path to the file being debugged on the remote machine in case of remote debugging i.e when `mode` is set to `remote`. See the section on [Remote Debugging](#remote-debugging) for details
processId | Applicable only when using the `attach` request with `local` mode. This is the id of the process that is running your executable which needs debugging.


### Using VS Code variables in debug configuration

Any property in the debug configuration that takes a folder/file path can use the below VS Code variables

* `${workspaceFolder}` to debug package at the root of the workspace that is opened in VS Code 
* `${file}` to debug the current file.
* `${fileDirname}` to debug the package to which the current file belongs to.

### Using build tags

If your build needs build tags (e.g. `go build -tags=whatever_tag`), then add the parameter `buildFlags` with the content `"-tags=whatever_tag"`.  Multiple tags are supported, by *enclosing them in single quotes within the double quotes* like so: `"-tags='first_tag second_tag third_tag'"`.




## Snippets for Debug Configurations

You can make use of snippets for the debug configuration while editing the launch.json file. 
Type "Go" and you will get snippets for debugging current file/package, a test function etc.

### Sample configuration to debug the current file

```json
{
	"name": "Launch file",
	"type": "go",
	"request": "launch",
	"mode": "auto",
	"program": "${file}"
}
```

### Sample configuration to debug a single test

```json
{
	"name": "Launch test function",
	"type": "go",
	"request": "launch",
	"mode": "test",
	"program": "${workspaceFolder}",
	"args": [
		"-test.run",
		"MyTestFunction"
	]
}
```

### Sample configuration to debug all tests in the package

```json
{
	"name": "Launch test package",
	"type": "go",
	"request": "launch",
	"mode": "test",
	"program": "${workspaceFolder}"
}
```

### Sample configuration to debug a pre-built binary

```json
{
	"name": "Launch executable",
	"type": "go",
	"request": "launch",
	"mode": "exec",
	"program": "absolute-path-to-the-executable"
}
```

### Sample configuration to attach to an already running local process using processId
Enter the id of the process running your executable in the below snippet

```json
{
	"name": "Attach to local process",
	"type": "go",
	"request": "attach",
	"mode": "local",
	"processId": 0
}
```

## Remote Debugging

To remote debug using VS Code, you must first run a headless Delve server on the target machine. The below examples assume
that you are in the same folder as the package you want to debug. If not, please refer to the [usage doc on dlv debug](https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_debug.md) command. 

```bash
$ dlv debug --headless --listen=:2345 --log --api-version=2
```

Any arguments that you want to pass to the program you are debugging must be passed to this Delve server that runs on the target machine. For example:

```bash
$ dlv debug --headless --listen=:2345 --log -- -myArg=123
```

Then, create a remote debug configuration in VS Code `launch.json`.

```json
{
	"name": "Launch remote",
	"type": "go",
	"request": "launch",
	"mode": "remote",
	"remotePath": "absolute-path-to-the-file-being-debugged-on-the-remote-machine",
	"port": 2345,
	"host": "127.0.0.1",
	"program": "absolute-path-to-the-file-on-the-local-machine",
	"env": {}
}
```

- The above example runs both the headless `dlv` server and the VS Code debugger locally on the same machine. Update `port` and `host` as per your set up on the remote machine instead.
- `remotePath` should point to the absolute path of the file (in your source code) being debugged in the remote machine
- `program` should point to the absolute path of the file on your local machine that is the counterpart of the file in `remotePath`

When you launch the debugger with this new `Launch remote` target selected, VS Code will send debugging
commands to the `dlv` server you started previously instead of launching it's own `dlv` instance against your app.

See the example of debugging a process running in a docker host at https://github.com/lukehoban/webapp-go/tree/debugging.


## Troubleshooting

If you have issues debugging your Go code, first try to update your version of delve to ensure that you are working with the latest delve and it has been compiled using your current Go version. To do this, run the command `Go: Install/Update Tools`, select `dlv`, press `Ok`.

### Enabling debug logs

- Set `showLog` attribute in your debug configuration to `true`. You will see logs in the debug console from delve.

- Set `trace` attribute in your debug configuration to `log`. You will see logs in the debug console from the Go extension's debug adapter. These logs will be saved to a file whose path will be printed at the beginning in the debug console.

- Set `logOutput` attribute in your debug configuration to `rpc`. You will see logs corresponding to the RPC messages going back and forth between VS Code and delve. Note that this first requires to set `showLog` to `true`. 
   - The `logOutput` attribute corresponds to the `--log-output` flag used by delve and can be a comma separated list of components that should produce debug output. 

### Debug the debugger using source code

If you want to dig deeper and debug the debugger using source code of this extension, see [building-and-debugging-the-extension](Building,-Debugging-and-Sideloading-the-extension-in-Visual-Studio-Code#building-and-debugging-the-extension.md)

### Common issues

#### Unverified breakpoint or variables not loading when debugging a binary

Ensure that the binary being debugged was built with no optimizations. Use the flags `-gcflags="all=-N -l"` when building the binary.

#### Cannot find package ".." in any of ... 

The debugger is not using the right GOPATH. This shouldn't happen, if it does, log a bug. 

**_Solution_**: Until the bug you logged is resolved, the work around is to add the GOPATH as an env var in the `env` property in the `launch.json` file.

#### Failed to continue: "Error: spawn EACCES"

You have `dlv` running just fine from command line, but VS Code gives this access related error. 
This can happen if the extension is trying to run the `dlv` binary from a wrong location.
The Go extension first tries to find `dlv` in your $GOPATH/bin and then in your $PATH.  

**_Solution_**: Run `which dlv` in the command line. If this doesn't match your `GOPATH/bin`, then delete the `dlv` file in 
your `GOPATH/bin`

#### could not launch process: stat ***/debug.test: no such file or directory

You may see this in the debug console, while trying to run in the `test` mode. This happens when the `program` attribute points to a folder with no test files.

**_Solution_**: Ensure that the `program` attribute points to the folder that contains the test files you want to run.

#### delve/launch hangs with no messages when using WSL
Try running ```delve debug ./main``` at the WSL command line and see if you get a prompt

**_Solution_**: Ensure you are running the WSL 2 Kernel, which (as of 4/15/2020) requires an early release of the Windows 10 OS.  This is available to anyone via the Windows Insider program.  See [WSL 2 Installation](https://docs.microsoft.com/en-us/windows/wsl/wsl2-install)

#### could not launch process: could not fork/exec

##### OSX 

This usually happens in OSX due to signing issues. See the discussions in please see [#717](https://github.com/Microsoft/vscode-go/issues/717), [#269](https://github.com/Microsoft/vscode-go/issues/269) and [derekparker/delve/357](https://github.com/derekparker/delve/issues/357)

**_Solution_**: You may have to uninstall dlv and install it manually as per [instructions](https://github.com/derekparker/delve/blob/master/Documentation/installation/osx/install.md#manual-install)

##### Linux/Docker 

Docker has security settings preventing ptrace(2) operations by default within the container.

**_Solution_**: To run your container insecurely, pass `--security-opt=seccomp:unconfined` to docker run when starting. Reference: [derekparker/delve/515](https://github.com/derekparker/delve/issues/515)

#### could not launch process: exec: "lldb-server": executable file not found in $PATH

This error can show up for Mac users using delve of version 0.12.2 or above. Not sure why, but doing a `xcode-select --install` has solved the problem for users who have seen this issue.

#### Unverified breakpoints when remote debugging

Check the version of delve api being used in the remote delve process i.e check the value for the flag `–api-version`. This needs to match the version used by the Go extension which uses version 2 by default. You can change the api version being used by the extension by editing the debug configuration in the launch.json file.

#### Try using dlv from the terminal/command-line

Add `"trace": "log"` to your debug configuration and debug in VS Code. This will send logs to the debug console where you can see the actual call being made to dlv. You can copy that and run it in your terminal
