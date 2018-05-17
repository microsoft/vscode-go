# Go Debug Adapter

This code runs in a seperate Node process spawned by Code when launch the 'go' type in the Code debugger.

## Debugging the debugger

The ideal setup involves three instances of Code:

1. Clone this [repo](https://github.com/Microsoft/vscode-go) and then run `npm install` 
```
git clone https://github.com/Microsoft/vscode-go
cd vscode-go
npm install
```
2. Open the `vscode-go` folder in one instance.  Choose the `Launch Extension` debug target and hit F5 to launch a second instance.
3. In the second instance, open the Go application you'd like to test against.  In that instance, create a new Go debug target pointing at the program you want to debug, and add `"debugServer": 4711` in the root of the configuration.
4. Open another instance of Code on the `vscode-go/src/debugAdapter` folder.  In that instance hit F5 to launch the debug adapter in server mode under the debugger.
5. Go back to the second instance and hit F5 to debug your Go code.  Debuggers from the other two Code windows are attached to the Go debug adapter and the Go language integation respectively, so you can set breakpoints, step through code and inspect state as needed. 
