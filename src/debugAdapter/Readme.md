# Go Debug Adapter

The Debug Adapter code runs in a separate Nodejs process spawned by Visual Studio Code when you debug Go code.

Please see [The Debug Adapter Protocol](https://code.visualstudio.com/blogs/2018/08/07/debug-adapter-protocol-website) to understand how the Debug Adapter acts as an intermediary between VS Code and the debugger which in case of Go is [delve](https://github.com/derekparker/delve)

# Preliminary steps

Clone this [repo](https://github.com/Microsoft/vscode-go) and then run `npm install`

```
git clone https://github.com/Microsoft/vscode-go
cd vscode-go
npm install
```

## Debugging the Go Debug Adapter

This is the option you would take if you want to understand or change the way the Go debug adapter interacts with delve.

This lets you debug the code in the `goDebug.ts` file which powers the debug adapter which runs in a different Nodejs process than the rest of the extension.
Therefore, you won't be able to debug the code powering the rest of the extension. 

1. Open the `vscode-go` folder in VS Code. Choose the `Launch as server` debug configuraion from the drop down in the debug viewlet. Add a breakpoint in the desired localtion in the `vscode-go/src/debugAdapter/goDebug.ts` file
2. Open the Go application that you want to debug in another instance of VS Code. Create a debug configuration if it doesnt exist. In this configuration add `"debugServer": 4711` in the root of the configuration. Start debugging your Go application and the breakpoint in the `goDebug.ts` file in the other VS Code instance will be hit.

## Debugging the Go Debug Adapter as well as the rest of the extension

This is the option you would take if you have changes both in the `goDebug.ts` file (which powers the debug adapter) as well any of the other files in this project.
This setup involves three instances of Visual Studio Code:

1. Open the `vscode-go` folder in one instance. Choose the `Launch Extension` debug target and hit F5. This will launch a second instance of Visual Studio Code.
2. In the second instance, open the Go application you'd like to debug. Here, create a new Go debug configuration pointing at the program you want to debug. Add `"debugServer": 4711` in the root of the configuration.
3. Open another instance of Code on the `vscode-go/src/debugAdapter` folder. In this instance hit F5 to launch the debug adapter in server mode under the debugger.
4. Go back to the second instance and hit F5 to debug your Go code. Debuggers from the other two Code windows are attached to the Go debug adapter and the Go language integration respectively, so you can set breakpoints, step through code and inspect state as needed.

## Debugging the Debug Adapter as well as Visual Studio Code

In some edge cases (like veryfing workbench behavior and state before executing debug adapter apicalls) debugging VS Code itself can be helpful. Once you ensure that you can [build and run Visual Studio Code](https://github.com/Microsoft/vscode/wiki/How-to-Contribute#build-and-run) from source successfully, follow the below steps:

1. Follow the [preliminary steps to build vscode-go](#preliminary-steps)
2. Sideload the your local vscode-go extension to the locally run Visual Studio Code. This is done by copying the contents of the vscode-go folder into `$HOME/.vscode-oss-dev/extensions/ms-vscode.go` (the location may vary by OS)
3. Open the `vscode` folder in Visual Studio Code. Launch the VS Code debug instance (OSS - Code) by choosing the `Launch VS Code` debug configuraion from the drop down in the debug viewlet. Add a breakpoint in the desired localtion.
4. In another instance of Visual Studio Code, open the `vscode-go` folder. Choose the `Launch as server` debug configuration from the drop down in the debug viewlet. Add a breakpoint in the desired localtion in the `vscode-go/src/debugAdapter/goDebug.ts` file
5. Open the Go application that you want to debug in the OSS Code instance initiated in step 3. Create a debug configuration if it doesnt exist. In this configuration add `"debugServer": 4711` in the root of the configuration. Start debugging your Go application and the breakpoint in the `goDebug.ts` file in the other VS Code instance will be hit, along with the breakpoints set up in the vscode files



