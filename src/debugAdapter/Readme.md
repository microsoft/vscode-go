# Go Debug Adapter

This code runs in a separate Node process spawned by Code when you debug Go code.

Please see [The Debug Adapter Protocol](https://code.visualstudio.com/blogs/2018/08/07/debug-adapter-protocol-website) to understand how the Debug Adapter acts as an intermediary between VS Code and the debugger which in case of Go is [delve](https://github.com/derekparker/delve)

# Preliminary steps

Clone this [repo](https://github.com/Microsoft/vscode-go) and then run `npm install`

```
git clone https://github.com/Microsoft/vscode-go
cd vscode-go
npm install
```

## Debugging the Debug Adapter

1. Open the `vscode-go` folder in VS Code. Choose the `Launch as server` debug configuraion from the drop down in the debug viewlet. Add a breakpoint in the desired localtion in the `vscode-go/src/debugAdapter/goDebug.ts` file
2. Open the Go application that you want to debug in another instance of VS Code. Create a debug configuration if it doesnt exist. In this configuration add `"debugServer": 4711` in the root of the configuration. Start debugging your Go application and the breakpoint in the `goDebug.ts` file in the other VS Code instance will be hit.

## Debugging the Debug Adapter and VS Code

In some edge cases (like veryfing workbench behavior and state before executing debug adapter apicalls) debugging VS Code itself can be helpful. For instructions on how to set up VS Code from its source see [this guide](https://github.com/Microsoft/vscode/wiki/How-to-Contribute#build). In order to bring up an OSS Code instance you should be able to build the project at least once to verify that all dependencies are ok

1. Build and sideload your local vscode-go extension. This is done by copying the contents of the vscode-go folder into `$HOME/.vscode-oss-dev/extensions/ms-vscode.go` (the location may vary by OS)
2. Launch the VS Code debug instance (OSS - Code) by choosing the `Launch VS Code` debug configuraion from the drop down in the debug viewlet. Add a breakpoint in the desired localtion
3. Open the `vscode-go` folder in VS Code. Choose the `Launch as server` debug configuraion from the drop down in the debug viewlet. Add a breakpoint in the desired localtion in the `vscode-go/src/debugAdapter/goDebug.ts` file
4. Open the Go application that you want to debug in the OSS Code instance initiated in #2. Create a debug configuration if it doesnt exist. In this configuration add `"debugServer": 4711` in the root of the configuration. Start debugging your Go application and the breakpoint in the `goDebug.ts` file in the other VS Code instance will be hit, along with the breakpoints set up in the vscode files

## Debugging the Debug Adapter and extension code

If you have changes in any file other than `goDebug.ts` which you want to use, then this setup involves three instances of Code:

1. Open the `vscode-go` folder in one instance. Choose the `Launch Extension` debug target and hit F5 to launch a second instance.
2. In the second instance, open the Go application you'd like to test against. In that instance, create a new Go debug target pointing at the program you want to debug, and add `"debugServer": 4711` in the root of the configuration.
3. Open another instance of Code on the `vscode-go/src/debugAdapter` folder. In that instance hit F5 to launch the debug adapter in server mode under the debugger.
4. Go back to the second instance and hit F5 to debug your Go code. Debuggers from the other two Code windows are attached to the Go debug adapter and the Go language integration respectively, so you can set breakpoints, step through code and inspect state as needed.
