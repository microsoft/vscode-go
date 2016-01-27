# Go for Visual Studio Code

[![Join the chat at https://gitter.im/Microsoft/vscode-go](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/Microsoft/vscode-go?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

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
- Add Imports (using `go list`)
- [_partially implemented_] Debugging (using `delve`)

### IDE Features
![IDE](http://i.giphy.com/xTiTndDHV3GeIy6aNa.gif)

### Debugger
![IDE](http://i.giphy.com/3oEduO9Rx6awkds4es.gif)

## Using

First, you will need to install Visual Studio Code `0.10`. In the command palette (`cmd-shift-p`) select `Install Extension` and choose `Go`.  

In a terminal window with the GOPATH environment variable set to the GOPATH you want to work on, launch `code`.  Open your GOPATH folder or any subfolder you want to work on, then open a `.go` file to start editing.  You should see `Analysis Tools Missing` in the bottom right, clicking this will offer to install all of the Go tooling needed for the extension to suppport it's full feature set.  See the [Tools](#Tools) section below for more details.

_Note_: It is strongly encouraged to turn `Auto Save` on in Visual Studio Code (`File -> Auto Save`) when using this extension.  Many of the Go tools work only on saved files, and error reporting will be more interactive with `Auto Save` turned on.

### Options

The following Visual Studio Code settings are available for the Go extension.  These can be set in user preferences (`cmd+,`) or workspace settings (`.vscode/settings.json`).

```javascript
{
	"go.buildOnSave": true,
	"go.lintOnSave": true,
	"go.vetOnSave": true,
	"go.buildFlags": [],
	"go.lintFlags": [],
	"go.vetFlags": [],
	"go.useCodeSnippetsOnFunctionSuggest": false,
	"go.formatOnSave": false,
	"go.formatTool": "goreturns",
	"go.goroot": "/usr/local/go",
	"go.gopath": "/Users/lukeh/go"
}
```

### Commands

In addition to integrated editing features, the extension also provides several commands in the Command Palette for working with Go files:

* `Go: Add Import` to add an import from the list of pacakges in your Go context
* `Go: Current GOPATH` to see your currently configured GOPATH
* `Go: Run test at cursor` to run a test at the current cursor position in the active document
* `Go: Run tests in current package` to run all tests in the pacakge containing the active document 
* `Go: Run tests in current file` to run all tests in the current active document

### _Optional_: Debugging

To use the debugger, you must currently manually install `delve`.  See the [Installation Instructions](https://github.com/derekparker/delve/wiki/Building) for full details.  On OS X it requires creating a self-signed cert to sign the `dlv` binary.

Once this is installed, go to the Code debug viewlet and select the configuration gear, placing the following in your launch.json:

```json
{
	"version": "0.1.0",
	"configurations": [
		{
			"name": "Launch main.go",
			"type": "go",
			"request": "launch",
			"mode": "debug",
			"program": ".",
			"env": {},
			"args": []
		}
	]
}
```

The `program` option can refer to a package folder to debug, or a file within that folder.

The `mode` parameter can be set to:

* `debug` to compile the contents of the program folder and launch under the debugger. [default]
* `test` to debug tests in the program folder.
* `exec` to run a pre-built binary instead of building the current code in the program folder.

## Building and Debugging the Extension

You can set up a development environment for debugging the extension during extension development.

First make sure you do not have the extension installed in `~/.vscode/extensions`.  Then clone the repo somewhere else on your machine, run `npm install` and open a development instance of Code.

```bash
rm -rf ~/.vscode/extensions/lukehoban.Go
cd ~
git clone https://github.com/Microsoft/vscode-go
cd vscode-go
npm install
code . 
```

You can now go to the Debug viewlet and select `Launch Extension` then hit run (`F5`).

In the `[Extension Development Host]` instance, open your GOPATH folder.  

You can now hit breakpoints and step through the extension.

If you make edits in the extension `.ts` files, just reload (`cmd-r`) the `[Extension Development Host]` instance of Code to load in the new extension code.  The debugging instance will automatically reattach.

To debug the debugger, see [the debugAdapter readme](src/debugAdapter/Readme.md).

## Tools

The extension uses the following tools, installed in the current GOPATH.  If any tools are missing, you will see an "Analysis Tools Missing" warning in the bottom right corner of the editor.  Clicking it will offer to install the missing tools for you. 

- gocode: `go get -u -v github.com/nsf/gocode`
- godef: `go get -u -v github.com/rogpeppe/godef`
- golint: `go get -u -v github.com/golang/lint/golint`
- go-find-references: `go get -u -v github.com/lukehoban/go-find-references`
- go-outline: `go get -u -v github.com/lukehoban/go-outline`
- goreturns: `go get -u -v sourcegraph.com/sqs/goreturns`
- gorename: `go get -u -v golang.org/x/tools/cmd/gorename`

To install them just paste and run:
```bash
go get -u -v github.com/nsf/gocode
go get -u -v github.com/rogpeppe/godef
go get -u -v github.com/golang/lint/golint
go get -u -v github.com/lukehoban/go-find-references
go get -u -v github.com/lukehoban/go-outline
go get -u -v sourcegraph.com/sqs/goreturns
go get -u -v golang.org/x/tools/cmd/gorename
```

And for debugging:

- delve: Follow the instructions at https://github.com/derekparker/delve/wiki/Building.

## License
[MIT](LICENSE)
