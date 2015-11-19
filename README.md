# Go for Visual Studio Code

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
- [_partially implemented_] Debugging (using `delve`)

### IDE Features
![IDE](http://i.giphy.com/xTiTndDHV3GeIy6aNa.gif)

### Debugger
![IDE](http://i.giphy.com/3oEduO9Rx6awkds4es.gif)

## Using

First, you will need to install Visual Studio Code `0.10`. In the command palette (`cmd-shift-p`) select `Install Extension` and choose `Go`.  

In a terminal window with the GOPATH environment variable set to the GOPATH you want to work on, launch `code`.  Open you GOPATH folder or any subfolder you want to work on, then open a `.go` file to start editing.

_Note_: It is strongly encouraged to turn `Auto Save` on in Visual Studio Code (`File -> Auto Save`) when using this extension.  Many of the Go tools work only on saved files, and error reporting will be more interactive with `Auto Save` turned on.

### Options

The following Visual Studio Code settings are available for the Go extension.  These can be set in user preferences (`cmd+,`) or workspace settings (`.vscode/settings.json`).

```javascript
{
	"go.buildOnSave": true,
	"go.lintOnSave": true,
	"go.vetOnSave": true,
	"go.formatTool": "goreturns",
	"go.gopath": "/Users/lukeh/go"
}
```

### _Optional_: Debugging

To use the debugger, you must currently manually install `delve`.  See the [Installation Instructions](https://github.com/derekparker/delve/wiki/Building) for full details.  This is not yet supported on Windows, and on OS X it requires creating a self-signed cert to sign the `dlv` binary.

Once this is installed, go to the Code debug viewlet and select the configuration gear, placing the following in your launch.json:

```json
{
	"version": "0.1.0",
	"configurations": [
		{
			"name": "Launch main.go",
			"type": "go",
			"request": "launch",
			"program": "main.go",
			"stopOnEntry": false,
			"env": {},
			"args": [],
			"cwd": "."
		}
	]
}
```

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

The extension uses the following tools, installed in the current GOPATH.  If any tools are missing, the extension will offer to install them for you.

- gocode: `go get -u -v github.com/nsf/gocode`
- godef: `go get -u -v github.com/rogpeppe/godef`
- golint: `go get -u -v github.com/golang/lint/golint`
- go-find-references: `go get -u -v github.com/lukehoban/go-find-references`
- goreturns: `go get -u -v sourcegraph.com/sqs/goreturns`
- gorename: `go get -u -v golang.org/x/tools/cmd/gorename`

To install them just paste and run 
```bash
go get -u -v github.com/nsf/gocode
go get -u -v github.com/rogpeppe/godef
go get -u -v github.com/golang/lint/golint
go get -u -v github.com/lukehoban/go-find-references
go get -u -v sourcegraph.com/sqs/goreturns
go get -u -v golang.org/x/tools/cmd/gorename
```

And for debugging:

- delve: Follow the instructions at https://github.com/derekparker/delve/wiki/Building.

## License
[MIT](LICENSE)
