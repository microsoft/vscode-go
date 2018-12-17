# Go Debug Adapter

This code runs in a separate Node process spawned by Code when launch the 'go' type in the Code debugger.

## Debugging the debugger

Clone this [repo](https://github.com/Microsoft/vscode-go) and then run `npm install`

```
git clone https://github.com/Microsoft/vscode-go
cd vscode-go
npm install
```

1. Open the `vscode-go` folder in VS Code. Choose the `Launch as server` debug configuraion from the drop down in the debug viewlet. Add a breakpoint in the desired localtion in the `vscode-go/src/debugAdapter/goDebug.ts` file
2. Open the Go application that you want to debug in another instance of VS Code. Create a debug configuration if it doesnt exist. In this configuration add `"debugServer": 4711` in the root of the configuration. Start debugging your Go application and the breakpoint in the `goDebug.ts` file in the other VS Code instance will be hit.

If you have changes in any file other `goDebug.ts` which you want to use, then this setup involves three instances of Code:

1. Open the `vscode-go` folder in one instance. Choose the `Launch Extension` debug target and hit F5 to launch a second instance.
2. In the second instance, open the Go application you'd like to test against. In that instance, create a new Go debug target pointing at the program you want to debug, and add `"debugServer": 4711` in the root of the configuration.
3. Open another instance of Code on the `vscode-go/src/debugAdapter` folder. In that instance hit F5 to launch the debug adapter in server mode under the debugger.
4. Go back to the second instance and hit F5 to debug your Go code. Debuggers from the other two Code windows are attached to the Go debug adapter and the Go language integration respectively, so you can set breakpoints, step through code and inspect state as needed.
