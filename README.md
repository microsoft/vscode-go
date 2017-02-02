# Go for Visual Studio Code

[![Join the chat at https://gitter.im/Microsoft/vscode-go](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/Microsoft/vscode-go?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge) [![Build Status](https://travis-ci.org/Microsoft/vscode-go.svg?branch=master)](https://travis-ci.org/Microsoft/vscode-go)


**Important Note: If you have recently upgraded to Go 1.7, you may need to run `gocode close` in your terminal to ensure Go completion lists continue to work correctly.  See https://github.com/Microsoft/vscode-go/issues/441.**

Read the [Release Notes](https://github.com/Microsoft/vscode-go/wiki/Release-Notes) to know what has changed over the last few versions of this extension

This extension adds rich language support for the Go language to VS Code, including:

- Completion Lists (using `gocode`)
- Signature Help (using `gogetdoc` or `godef`+`godoc`)
- Snippets
- Quick Info (using `gogetdoc` or `godef`+`godoc`)
- Goto Definition (using `gogetdoc` or `godef`+`godoc`)
- Find References (using `guru`)
- File outline (using `go-outline`)
- Workspace symbol search (using `go-symbols`)
- Rename (using `gorename`. Note: For Undo after rename to work in Windows you need to have `diff` tool in your path)
- Build-on-save (using `go build` and `go test`)
- Lint-on-save (using `golint` or `gometalinter`)
- Format (using `goreturns` or `goimports` or `gofmt`)
- Generate unit tests skeleton (using `gotests`)
- Add Imports (using `gopkgs`)
- [_partially implemented_] Debugging (using `delve`)

### IDE Features
![IDE](http://i.giphy.com/xTiTndDHV3GeIy6aNa.gif)

## Using

First, you will need to install Visual Studio Code. Then, in the command palette (`cmd-shift-p`) select `Install Extension` and choose `Go`.

In a terminal window with the GOPATH environment variable set to the GOPATH you want to work on, launch `code`.  Open your GOPATH folder or any subfolder you want to work on, then open a `.go` file to start editing.  You should see `Analysis Tools Missing` in the bottom right, clicking this will offer to install all of the Go tooling needed for the extension to support its full feature set.  See the [Tools](#tools) section below for more details.

_Note_: Users may want to consider turning `Auto Save` on in Visual Studio Code (`"files.autoSave": "afterDelay"`) when using this extension.  Many of the Go tools work only on saved files, and error reporting will be more interactive with `Auto Save` turned on. If you do turn `Auto Save` on, you may also want to turn format-on-save off (`"go.formatOnSave": false`), so that it is not triggered while typing.

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
	"go.formatFlags": [],
	"go.goroot": "/usr/local/go",
	"go.gopath": "/Users/lukeh/go",
	"go.inferGopath": false,
	"go.gocodeAutoBuild": false
}
```

### Linter

A linter is a tool giving coding style feedback and suggestions.
By default this extension uses the official [golint](https://github.com/golang/lint) as a linter.

You can change the default linter and use the more advanced [Go Meta Linter](https://github.com/alecthomas/gometalinter)
by setting `go.lintTool` to "gometalinter" in your settings.

Go meta linter uses a collection of various linters which will be installed for you by the extension.

Some of the very useful linter tools:
* [errcheck](https://github.com/kisielk/errcheck) checks for unchecked errors in your code.
* [varcheck](https://github.com/opennota/check) finds unused global variables and constants.
* [deadcode](https://github.com/tsenart/deadcode) finds unused code.

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
* `Go: Test Previous` to run the previously run test command
* `Go: Generates unit tests (package)` Generates unit tests for the current package
* `Go: Generates unit tests (file)` Generates unit tests for the current file
* `Go: Generates unit tests (function)` Generates unit tests for the selected function in the current file
* `Go: Install Tools` Installs/updates all the Go tools that the extension depends on

### _Optional_: Debugging

To use the debugger, you must currently manually install `delve`.  See the [Installation Instructions](https://github.com/derekparker/delve/tree/master/Documentation/installation) for full details.  On OS X it requires creating a self-signed cert to sign the `dlv` binary.

For more read [Debugging Go Code Using VS Code](https://github.com/Microsoft/vscode-go/wiki/Debugging-Go-code-using-VS-Code)

#### Remote Debugging

To remote debug using VS Code, read [Remote Debugging](https://github.com/Microsoft/vscode-go/wiki/Debugging-Go-code-using-VS-Code#remote-debugging) 

## Building and Debugging the Extension

You can set up a development environment for debugging the extension during extension development.

Clone the repo, run `npm install` and open a development instance of Code.

```bash
git clone https://github.com/Microsoft/vscode-go
cd vscode-go
npm install
code .
```

You can now go to the Debug viewlet and select `Launch Extension` then hit run (`F5`).

In the `[Extension Development Host]` instance, open any folder with Go code.

You can now hit breakpoints and step through the extension.

If you make edits in the extension `.ts` files, just reload (`cmd-r`) the `[Extension Development Host]` instance of Code to load in the new extension code.  The debugging instance will automatically reattach.

To debug the debugger, see [the debugAdapter readme](src/debugAdapter/Readme.md).

## Tools

The extension uses the following tools, installed in the current GOPATH.  If any tools are missing, you will see an "Analysis Tools Missing" warning in the bottom right corner of the editor.  Clicking it will offer to install the missing tools for you.

- gocode: `go get -u -v github.com/nsf/gocode`
- godef: `go get -u -v github.com/rogpeppe/godef`
- gogetdoc: `go get -u -v github.com/zmb3/gogetdoc`
- golint: `go get -u -v github.com/golang/lint/golint`
- go-outline: `go get -u -v github.com/lukehoban/go-outline`
- goreturns: `go get -u -v sourcegraph.com/sqs/goreturns`
- gorename: `go get -u -v golang.org/x/tools/cmd/gorename`
- gopkgs: `go get -u -v github.com/tpng/gopkgs`
- go-symbols: `go get -u -v github.com/newhook/go-symbols`
- guru: `go get -u -v golang.org/x/tools/cmd/guru`
- gotests: `go get -u -v github.com/cweill/gotests/...`

If you wish to have the extension use a separate GOPATH for its tools, provide the desired location in the setting `go.toolsGopath`.
`gometalinter` and `dlv` are two tools that are exceptions, and will need to be installed in your GOPATH.

To install the tools manually in the current GOPATH, just paste and run:
```bash
go get -u -v github.com/nsf/gocode
go get -u -v github.com/rogpeppe/godef
go get -u -v github.com/zmb3/gogetdoc
go get -u -v github.com/golang/lint/golint
go get -u -v github.com/lukehoban/go-outline
go get -u -v sourcegraph.com/sqs/goreturns
go get -u -v golang.org/x/tools/cmd/gorename
go get -u -v github.com/tpng/gopkgs
go get -u -v github.com/newhook/go-symbols
go get -u -v golang.org/x/tools/cmd/guru
go get -u -v github.com/cweill/gotests/...
```

And for debugging:

- delve: Follow the instructions at https://github.com/derekparker/delve/blob/master/Documentation/installation/README.md.

## License
[MIT](LICENSE)
