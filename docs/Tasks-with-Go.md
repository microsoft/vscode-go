## How do I use VS Code's "Tasks" with Go?

Invoke `Tasks: Configure Task Runner` from the command palette.

This will create a `tasks.json` file in your workspace's `.vscode` folder.  Replace the contents of this file with:

```json
{
	"version": "0.1.0",
	"command": "go",
	"isShellCommand": true,
	"showOutput": "silent",
	"tasks": [
		{
			"taskName": "install",
			"args": [ "-v", "./..."],
			"isBuildCommand": true
		},
		{
			"taskName": "test",
			"args": [ "-v", "./..."],
			"isTestCommand": true
		}
	]
}
```
```json
{
	"version": "2.0.0",	
	"type": "shell",	
	"echoCommand": true,
	"cwd": "${workspaceFolder}",
	"tasks": [
		{
			"label": "rungo",
			"command": "go run ${file}",
			"group": {
				"kind": "build",
				"isDefault": true
			}
		},		
	]
}

```

You can now invoke <kbd>ctrl/cmd</kbd>+<kbd>shift</kbd>+<kbd>b</kbd> to run `go install -v ./...` and report results in the output window, or <kbd>ctrl/cmd</kbd>+<kbd>shift</kbd>+<kbd>t</kbd> to run `go test -v ./...`.

You can use this same technique to invoke other build and test tools. For example, to invoke makefile targets if your build is defined in a makefile, or to invoke tools like `go generate`.

More on configuring tasks in VS Code can be found at https://code.visualstudio.com/docs/editor/tasks.

You can define a specific task to run only some tests:

```
{
    "version": "0.1.0",
    "command": "go",
    "isShellCommand": true,
    "showOutput": "silent",
    "suppressTaskName": true,
    "tasks": [
        {
            "taskName": "Full test suite",
            "args": [ "test", "v", "./..."]
        },
        {
            "taskName": "Blog User test suite",
            "args": [ "test", "./...", "-test.v", "-test.run", "User"]
        }
    ]
}
```

The above task would run all tests with `User` in their name.





