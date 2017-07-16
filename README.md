# Go for Visual Studio Code

[![Join the chat at https://gitter.im/Microsoft/vscode-go](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/Microsoft/vscode-go?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge) [![Build Status](https://travis-ci.org/Microsoft/vscode-go.svg?branch=master)](https://travis-ci.org/Microsoft/vscode-go)


**Important Note: If you have recently upgraded to Go 1.8 or Go 1.9, you may need to run `gocode close` in your terminal and rebuild `gocode` to ensure Go completion lists continue to work correctly.  See https://github.com/Microsoft/vscode-go/issues/441.**

Read the [Release Notes](https://github.com/Microsoft/vscode-go/wiki/Release-Notes) to know what has changed over the last few versions of this extension

This extension adds rich language support for the Go language to VS Code, including:

- Completion Lists (using `gocode`)
- Signature Help (using `gogetdoc` or `godef`+`godoc`)
- Snippets
- Quick Info (using `gogetdoc` or `godef`+`godoc`)
- Goto Definition (using `gogetdoc` or `godef`+`godoc`)
- Find References (using `guru`)
- References CodeLens
- File outline (using `go-outline`)
- Workspace symbol search (using `go-symbols`)
- Rename (using `gorename`. Note: For Undo after rename to work in Windows you need to have `diff` tool in your path)
- Build-on-save (using `go build` and `go test`)
- Lint-on-save (using `golint` or `gometalinter`)
- Format (using `goreturns` or `goimports` or `gofmt`)
- Generate unit tests skeleton (using `gotests`)
- Add Imports (using `gopkgs`)
- Add/Remove Tags on struct fields (using `gomodifytags`)
- Semantic/Syntactic error reporting as you type (using `gotype-live`)
- Run Tests under the cursor, in current file, in current package, in the whole workspace (using `go test`)
- Generate method stubs for interfaces (using `impl`)
- [_partially implemented_] Debugging (using `delve`)

### IDE Features
![IDE](https://i.giphy.com/xTiTndDHV3GeIy6aNa.gif)

## Using

First, you will need to install Visual Studio Code. Then, in the command palette (`cmd-shift-p`) select `Install Extension` and choose `Go`.

In a terminal window with the GOPATH environment variable set to the GOPATH you want to work on, launch `code`.  Open your GOPATH folder or any subfolder you want to work on, then open a `.go` file to start editing.  You should see `Analysis Tools Missing` in the bottom right, clicking this will offer to install all of the Go tooling needed for the extension to support its full feature set.  See the [Tools](#tools-this-extension-depends-on) section below for more details.

_Note 1_: Read [GOPATH in the VS Code Go extension](https://github.com/Microsoft/vscode-go/wiki/GOPATH-in-the-VS-Code-Go-extension) to learn about the different ways you can get the extension to set GOPATH.

_Note 2_: Users may want to consider turning `Auto Save` on in Visual Studio Code (`"files.autoSave": "afterDelay"`) when using this extension.  Many of the Go tools work only on saved files, and error reporting will be more interactive with `Auto Save` turned on. If you do turn `Auto Save` on, you may also want to turn format-on-save off (`"go.formatOnSave": false`), so that it is not triggered while typing.

_Note 3_:  This extension uses `gocode` to provide completion lists as you type. To provide fresh results, including against not-yet-built dependencies, the extension uses `gocode`'s `autobuild=true` setting. If you experience any performance issues with autocomplete, you should try setting `"go.gocodeAutoBuild": false` in your VS Code settings.

### Customizing the Go extension features

The Go extension is ready to use on the get go. If you want to customize the features, you can edit the settings in your User or Workspace settings. Read [Settings for Visual Studio Code Go extension](https://github.com/Microsoft/vscode-go/wiki/Settings-for-Visual-Studio-Code-Go-extension) for the full list of options and their descriptions.


### Go Language Server (Experimental)
Set `go.useLanguageServer` to `true` to use the Go language server from [Sourcegraph](https://github.com/sourcegraph/go-langserver) for features like Hover, Definition, Find All References, Signature Help, Go to Symbol in File and Workspace.
* This is an experimental feature and is not available in Windows yet.
* If set to true, you will be prompted to install the Go language server. Once installed, you will have to reload VS Code window. The language server will then be run by the Go extension in the background to provide services needed for the above mentioned features.
* Everytime you change the value of the setting `go.useLanguageServer`, you need to reload the VS Code window for it to take effect.
* To collect traces, set `"go.languageServerFlags": ["-trace"]`
* To collect errors from language server in a logfile, set `"go.languageServerFlags": ["-trace", "-logfile", "path to a text file that exists" ]`


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

Alternatively, you can use [megacheck](https://github.com/dominikh/go-tools/tree/master/cmd/megacheck) which 
may have significantly better performance than `gometalinter`, while only supporting a subset of the tools.

Finally, the result of those linters will show right in the code (locations with suggestions will be underlined),
as well as in the output pane.

### Commands

In addition to integrated editing features, the extension also provides several commands in the Command Palette for working with Go files:

* `Go: Add Import` to add an import from the list of packages in your Go context
* `Go: Current GOPATH` to see your currently configured GOPATH
* `Go: Test at cursor` to run a test at the current cursor position in the active document
* `Go: Test Package` to run all tests in the package containing the active document
* `Go: Test File` to run all tests in the current active document
* `Go: Test Previous` to run the previously run test command
* `Go: Test All Packages in Workspace` to run all tests in the current workspace
* `Go: Generates unit tests for package` Generates unit tests for the current package
* `Go: Generates unit tests for file` Generates unit tests for the current file
* `Go: Generates unit tests for function` Generates unit tests for the selected function in the current file
* `Go: Install Tools` Installs/updates all the Go tools that the extension depends on
* `Go: Add Tags` Adds configured tags to selected struct fields.
* `Go: Remove Tags` Removes configured tags from selected struct fields.
* `Go: Generate Interface Stubs` Generates method stubs for given interface

You can access all of the above commands from the command pallet (`Cmd+Shift+P` or `Ctrl+Shift+P`).

Few of these are available in the editor context menu as an experimental feature as well. To control which of these commands show up in the editor context menu, update the setting `go.editortorContextMenuCommands`


### _Optional_: Debugging

To use the debugger, you must currently manually install `delve`.  See the [Installation Instructions](https://github.com/derekparker/delve/tree/master/Documentation/installation) for full details.  On OS X it requires creating a self-signed cert to sign the `dlv` binary.

For more read [Debugging Go Code Using VS Code](https://github.com/Microsoft/vscode-go/wiki/Debugging-Go-code-using-VS-Code)

#### Remote Debugging

To remote debug using VS Code, read [Remote Debugging](https://github.com/Microsoft/vscode-go/wiki/Debugging-Go-code-using-VS-Code#remote-debugging)

## Building and Debugging the Extension

You can set up a development environment for debugging the extension during extension development.
Read more at [Building, Debugging and Sideloading the extension in Visual Studio Code](https://github.com/Microsoft/vscode-go/wiki/Building,-Debugging-and-Sideloading-the-extension-in-Visual-Studio-Code)

## Tools this extension depends on

This extension uses a host of Go tools to provide the various rich features. These tools are installed in your GOPATH by default. If you wish to have the extension use a separate GOPATH for its tools, provide the desired location in the setting `go.toolsGopath`. Read more about this and the tools at [Go tools that the Go extension depends on](https://github.com/Microsoft/vscode-go/wiki/Go-tools-that-the-Go-extension-depends-on)


## License
[MIT](LICENSE)
