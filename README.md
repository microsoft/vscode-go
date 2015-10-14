# Go for Visual Studio Code

> **NOTE:** All content within this repo is private and cannot be shared with others without the express written permission of the product team.

This extension adds rich language support for the Go language to VS Code, including:

- Colorization
- Completion Lists (using `gocode`)
- Snippets
- Quick Info (using `godef`)
- Goto Definition (using `godef`)
- Find References (using `go-find-references`)
- File outline (using `go-outline`)
- Rename (using `gorename`)
- Build-on-save (using `go build` and `go test`)
- Format (using `goreturns` or `goimports` or `gofmt`)
- [partially implemented] Debugging (using `delve`)

### IDE Features
![IDE](http://i.giphy.com/xTiTndDHV3GeIy6aNa.gif)

### Debugger
![IDE](http://i.giphy.com/3oEduO9Rx6awkds4es.gif)

## Using

First, you will need to install Visual Studio Code `0.9.1`.  

Next, clone this repo into your Code extensions folder and run `npm install`.

```bash
cd ~/.vscode/extensions/
git clone https://monacotools.visualstudio.com/DefaultCollection/Monaco/_git/go-code
cd go-code
npm install
```

In a terminal window with the GOPATH environment variable set to the GOPATH you want to work on, launch `code`.  Open you GOPATH folder or any subfolder you want to work on, then open a `.go` file to start editing.

### _Optional_: Debugging

To use the debugger, you must currently manually install `delve`.  See the [Installation Instructions](https://github.com/derekparker/delve/wiki/Building) for full details.  This is not yet supported on Windows, and on OS X it requires creating a self-signed cert to sign the `dlv` binary.

Once this is installed, go to the Code debug viewlet and select the configuration gear, placing the following in your launch.json:

```json
{
	"version": "0.1.0",
	"configurations": [
		{
			"name": "Delve test",
			"type": "go",
			"program": "/Users/lukeh/dd/go/src/github.com/lukehoban/azuretest/test.go"
		}
	]
}
```

## Building and Debugging the Extension

You can set up a development environment for debugging the extension during extension development.

First make sure you do not have the extension installed in `~/.vscode/extensions`.  Then clone the repo somewhere else on your machine, run `npm install` and open a development instance of Code.

```bash
rm -rf ~/.vscode/extensions/go-code
cd ~
git clone https://monacotools.visualstudio.com/DefaultCollection/Monaco/_git/go-code
cd go-code
npm install
code . 
```

To build, use the `Tasks: Run Build Task` command (`cmd-shift-B`).  This will start a build watcher so that .ts files are compiled on save.

You can now go to the Debug viewlet and select `Launch Extension` then hit play (`F5`).

In the `[Extension Development Host]` instance, open your GOPATH folder.  

You can now hit breakpoints and step through the extension.

If you make edits in the extension `.ts` files, just reload (`cmd-r`) the `[Extension Development Host]` instance of Code to load in the new extension code.  The debugging instance will automatically reattach. 

## Tools

The extension uses the following tools, installed in the current GOPATH.  If any tools are missing, the extension will offer to install them for you.

- gorename: `go get -u -v golang.org/x/tools/cmd/gorename`
- gocode: `go get -u -v github.com/nsf/gocode`
- goreturns: `go get -u -v sourcegraph.com/sqs/goreturns`
- godef: `go get -u -v github.com/rogpeppe/godef`
- golint: `go get -u -v github.com/golang/lint/golint`
- go-find-references: `go get -u -v github.com/lukehoban/go-find-references`

And for debugging:

- delve: `go get -u -v github.com/derekparker/delve/cmd/dlv`

## License
[MIT](LICENSE)