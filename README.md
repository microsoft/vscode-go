# Go for Visual Studio Code

[![Join the chat at https://gitter.im/Microsoft/vscode-go](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/Microsoft/vscode-go?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge) [![Build Status](https://travis-ci.org/Microsoft/vscode-go.svg?branch=master)](https://travis-ci.org/Microsoft/vscode-go)



This extension adds rich language support for the Go language to VS Code, including:

- Completion Lists (using `gocode`)
- Signature Help (using `godoc`)
- Snippets
- Quick Info (using `godef`)
- Goto Definition (using `godef`)
- Find References (using `guru`)
- File outline (using `go-outline`)
- Workspace symbol search (using `go-symbols`)
- Rename (using `gorename`)
- Build-on-save (using `go build` and `go test`)
- Lint-on-save (using `golint` or `gometalinter`)
- Format (using `goreturns` or `goimports` or `gofmt`)
- Add Imports (using `gopkgs`)
- [_partially implemented_] Debugging (using `delve`)

### IDE Features
![IDE](http://i.giphy.com/xTiTndDHV3GeIy6aNa.gif)

## Using

First, you will need to install Visual Studio Code. Then, in the command palette (`cmd-shift-p`) select `Install Extension` and choose `Go`.

In a terminal window with the GOPATH environment variable set to the GOPATH you want to work on, launch `code`.  Open your GOPATH folder or any subfolder you want to work on, then open a `.go` file to start editing.  You should see `Analysis Tools Missing` in the bottom right, clicking this will offer to install all of the Go tooling needed for the extension to support its full feature set.  See the [Tools](#tools) section below for more details.

_Note_: Users may want to consider turning `Auto Save` on in Visual Studio Code (`"files.autoSave": "afterDelay"`) when using this extension.  Many of the Go tools work only on saved files, and error reporting will be more interactive with `Auto Save` turned on. If you do turn `Auto Save` on, you may also want to turn format-on-save off (`"go.formatOnSave": "false"`), so that it is not triggered while typing.

_Note 2_:  This extension uses `gocode` to provide completion lists as you type. To provide fresh results, including against not-yet-built dependencies, the extension uses `gocode`'s `autobuild=true` setting. If you experience any performance issues with autocomplete, you should try setting `"go.gocodeAutoBuild": false` in your VS Code settings.

### Options

The following Visual Studio Code settings are available for the Go extension.  These can be set in user preferences (`cmd+,`) or workspace settings (`.vscode/settings.json`).

```javascript
{
	"go.buildOnSave": true,
	"go.lintOnSave": true,
	"go.vetOnSave": true,
	"go.buildTags": "",
	"go.buildFlags": [],
	"go.lintTool": "golint",
	"go.lintFlags": [],
	"go.vetFlags": [],
	"go.coverOnSave": false,
	"go.useCodeSnippetsOnFunctionSuggest": false,
	"go.formatOnSave": true,
	"go.formatTool": "goreturns",
	"go.goroot": "/usr/local/go",
	"go.gopath": "/Users/lukeh/go",
	"go.gocodeAutoBuild": false
}
```

### Linter

A linter is a tool giving coding style feedback and suggestions.
By default this extension uses the official [golint](https://github.com/golang/lint) as a linter.

You can change the default linter and use the more advanced [Go Meta Linter](https://github.com/alecthomas/gometalinter).
Note that you need to install the package manually: `go get -u github.com/alecthomas/gometalinter`
and edit your configuration (set the `go.lintTool` value to "gometalinter").

Go meta linter uses a collection of various linters and those linters also need to be installed manually.
If one of the tool is available, it will be used by default (`golint` for instance is still run by default).

Some of the very useful linter tools:
* [errcheck](https://github.com/kisielk/errcheck) checks for unchecked errors in your code.
* [varcheck](https://github.com/opennota/check) finds unused global variables and constants.
* [deadcode](https://github.com/tsenart/deadcode) finds unused code.

If you wish to install all the supported linter tools, gometalinter provides you with an installer:
`gometalinter --install`

If you want to run only specific linters (some linters are slow), you can modify your configuration to specify them:

```javascript
  "go.lintFlags": ["--disable-all", "--enable=errcheck"],
```

Finally, the result of those linters will show right in the code (locations with suggestions will be underlined),
as well as in the output pane.

### Commands

In addition to integrated editing features, the extension also provides several commands in the Command Palette for working with Go files:

* `Go: Add Import` to add an import from the list of packages in your Go context
* `Go: Current GOPATH` to see your currently configured GOPATH
* `Go: Run test at cursor` to run a test at the current cursor position in the active document
* `Go: Run tests in current package` to run all tests in the package containing the active document
* `Go: Run tests in current file` to run all tests in the current active document

### _Optional_: Debugging

To use the debugger, you must currently manually install `delve`.  See the [Installation Instructions](https://github.com/derekparker/delve/tree/master/Documentation/installation) for full details.  On OS X it requires creating a self-signed cert to sign the `dlv` binary.

Once this is installed, go to the Code debug viewlet and select the configuration gear, placing the following in your launch.json:

```json
{
	"version": "0.2.0",
	"configurations": [
		{
			"name": "Launch",
			"type": "go",
			"request": "launch",
			"mode": "debug",
			"program": "${workspaceRoot}",
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
* `exec` to run a pre-built binary specified in program, for example `"program":"${workspaceRoot}/mybin"`.
* `remote` to attach to a remote headless Delve server.  You must manually run Delve on the remote machine, and provide the additional `remotePath`, `host` and `port` debug configuration options pointing at the remote machine.

#### Remote Debugging

To remote debug using VS Code, you must first run a headless Delve server on the target machine.  For example:

```bash
$ dlv debug --headless --listen=:2345 --log
```

Then, create a remote debug configuration in VS Code `launch.json`.

```json
{
	"name": "Remote",
	"type": "go",
	"request": "launch",
	"mode": "remote",
	"remotePath": "${workspaceRoot}",
	"port": 2345,
	"host": "127.0.0.1",
	"program": "${workspaceRoot}",
	"env": {},
	"args": []
}
```

When you launch the debugger with this new `Remote` target selected, VS Code will send debugging
commands to the `dlv` server you started previously instead of launching it's own `dlv` instance against your app.

The above example runs both the headless `dlv` server and the VS Code debugger locally on the same machine.  For an
example of running these on different hosts, see the example of debugging a process running in a docker host at https://github.com/lukehoban/webapp-go/tree/debugging.

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
- go-outline: `go get -u -v github.com/lukehoban/go-outline`
- goreturns: `go get -u -v sourcegraph.com/sqs/goreturns`
- gorename: `go get -u -v golang.org/x/tools/cmd/gorename`
- gopkgs: `go get -u -v github.com/tpng/gopkgs`
- go-symbols: `go get -u -v github.com/newhook/go-symbols`
- guru: `go get -u -v golang.org/x/tools/cmd/guru`

To install them just paste and run:
```bash
go get -u -v github.com/nsf/gocode
go get -u -v github.com/rogpeppe/godef
go get -u -v github.com/golang/lint/golint
go get -u -v github.com/lukehoban/go-outline
go get -u -v sourcegraph.com/sqs/goreturns
go get -u -v golang.org/x/tools/cmd/gorename
go get -u -v github.com/tpng/gopkgs
go get -u -v github.com/newhook/go-symbols
go get -u -v golang.org/x/tools/cmd/guru
```

And for debugging:

- delve: Follow the instructions at https://github.com/derekparker/delve/blob/master/Documentation/installation/README.md.

## License
[MIT](LICENSE)
