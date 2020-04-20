# Go for Visual Studio Code

[![Join the chat at https://gitter.im/Microsoft/vscode-go](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/Microsoft/vscode-go?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge) [![Build Status](https://travis-ci.org/Microsoft/vscode-go.svg?branch=master)](https://travis-ci.org/Microsoft/vscode-go)

This extension adds rich language support for the [Go language](https://golang.org/) to VS Code.

Read the [Changelog](https://github.com/Microsoft/vscode-go/blob/master/CHANGELOG.md) to know what has changed over the last few versions of this extension.

## Table of Contents

- [Language Features](#language-features)
	- [IntelliSense](#intellisense)
	- [Code Navigation](#code-navigation)
	- [Code Editing](#code-editing)
	- [Diagnostics](#diagnostics)
	- [Testing](#testing)
	- [Debugging](#debugging)
	- [Others](#others)
- [How to use this extension?](#how-to-use-this-extension)
	- [Go Language Server](#go-language-server)
		- [Settings to control the use of the Go language server](#settings-to-control-the-use-of-the-go-language-server)
		- [Provide feedback on gopls](#provide-feedback-on-gopls)
	- [Linter](#linter)
	- [Commands](#commands)
	- [Optional: Debugging](#optional-debugging)
		- [Remote Debugging](#remote-debugging)
- [Install or update all dependencies](#install-or-update-all-dependencies)
- [Building and Debugging the Extension](#building-and-debugging-the-extension)
- [Tools this extension depends on](#tools-this-extension-depends-on)
- [Frequently Asked Questions (FAQ)](#frequently-asked-questions-faq)
- [Contributing](#contributing)
- [Code of Conduct](#code-of-conduct)
- [License](#license)

## Language Features

### IntelliSense

- Auto Completion of symbols as you type (using language server or `gocode`)
- Signature Help for functions as you type (using language server or `gogetdoc` or `godef`+`go doc`)
- Quick Info on the symbol as you hover over it (using language server or `gogetdoc` or `godef`+`go doc`)

### Code Navigation

- Go to or Peek Definition of symbols (using language server or `gogetdoc` or `godef`+`go doc`)
- Find References of symbols and Implementations of interfaces (using language server or `guru`)
- Go to symbol in file or see the file outline (using `go-outline`)
- Go to symbol in workspace (using language server or `go-symbols`)
- Toggle between a Go program and the corresponding test file.

### Code Editing

- [Code Snippets](https://github.com/microsoft/vscode-go/blob/master/snippets/go.json) for quick coding
- Format code on file save as well as format manually (using `goreturns` or `goimports` which also remove unused imports or `gofmt`). To disable the format on save feature, add `"[go]": {"editor.formatOnSave": false}` to your settings.
- Symbol Rename (using `gorename`. Note: For Undo after rename to work in Windows you need to have `diff` tool in your path)
- Add Imports to current file (using `gopkgs`)
- Add/Remove Tags on struct fields (using `gomodifytags`)
- Generate method stubs for interfaces (using `impl`)
- Fill struct literals with default values (using `fillstruct`)

### Diagnostics

- Build-on-save to compile code and show build errors. (using `go build` and `go test`)
- Vet-on-save to run `go vet` and show errors as warnings
- Lint-on-save to show linting errors as warnings (using `golint`, `staticcheck`, `golangci-lint` or `revive`)
- Semantic/Syntactic error reporting as you type (using `gotype-live`)

### Testing

- Run Tests under the cursor, in current file, in current package, in the whole workspace using either commands or codelens
- Run Benchmarks under the cursor using either commands or codelens
- Show code coverage either on demand or after running tests in the package.
- Generate unit tests skeleton (using `gotests`)

### Debugging

- Debug your code, binaries or tests (using `delve`)

### Others

- Install/Update all dependent Go tools
- Upload to the Go Playground (using `goplay`)

## How to use this extension?

Install and open [Visual Studio Code](https://code.visualstudio.com). Press `Ctrl+Shift+X` or `Cmd+Shift+X` to open the Extensions pane. Find and install the Go extension. You can also install the extension from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-vscode.Go). Open any `.go` file in VS Code. The extension is now activated.

This extension uses a set of Go tools to provide the various rich features. These tools are installed in your GOPATH by default. If you wish to have these tools in a separate location, provide the desired location in the setting `go.toolsGopath`. Read more about this and the tools at [Go tools that the Go extension depends on](https://github.com/Microsoft/vscode-go/wiki/Go-tools-that-the-Go-extension-depends-on).

You will see `Analysis Tools Missing` in the bottom right, clicking this will offer to install all of the dependent Go tools. You can also run the [command](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette) `Go: Install/Update tools` to install/update the same. You need to have git installed for these tool installations to work.

**Note 1**: Read [GOPATH in the VS Code Go extension](https://github.com/Microsoft/vscode-go/wiki/GOPATH-in-the-VS-Code-Go-extension) to learn about the different ways you can get the extension to set GOPATH.

**Note 2**: The `Format on save` feature has a timeout of 750ms after which the formatting is aborted. You can change this timeout using the setting `editor.formatOnSaveTimeout`. This feature gets disabled when you have enabled the `Auto Save` feature in Visual Studio Code.

**Note 3**:  Unless `go.useLanguageServer` is set to `true`, this extension uses `gocode` to provide completion lists as you type. If you have disabled the `go.buildOnSave` setting, then you may not get fresh results from not-yet-built dependencies. Therefore, ensure you have built your dependencies manually in such cases.

### Customizing the Go extension features

The Go extension is ready to use on the get go. If you want to customize the features, you can edit the settings in your User or Workspace settings. Read [All Settings & Commands in Visual Studio Code Go extension](https://github.com/Microsoft/vscode-go/wiki/All-Settings-&-Commands-in-Visual-Studio-Code-Go-extension) for the full list of options and their descriptions.


### Go Language Server

The Go extension uses a host of [Go tools](https://github.com/Microsoft/vscode-go/wiki/Go-tools-that-the-Go-extension-depends-on) to provide the various language features. An alternative is to use a single language server that provides the same features using the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)

Previously, we added support to use `go-langserver`, the [language server from Sourcegraph](https://github.com/sourcegraph/go-langserver). There is no active development for it anymore and it doesn't support Go modules. Therefore, we are now switching to use `gopls`, the [language server from Google](https://github.com/golang/go/wiki/gopls) which is currently in active development.

- If you are already using the language server from Sourcegraph, you can continue to use it as long as you are not using Go modules. We do suggest you to move to using `gopls` though.
    - To do so, delete the `go-langserver` binary/executable in your machine and this extension will prompt you to install `gopls` after a reload of the VS Code window.
- If you are working on a project that uses Go modules, you will be prompted to use the language server from Google as it provides much better support for Go modules.
- If you have never used language server before, and now opt to use it, you will be prompted to install and use the language server from Google as long as you are using a Go version > 1.10.

> Note: The language server from Google supports Go version > 1.10 only

#### Install/Update the Go language server

Ideally, you would see prompts to use/install/update the language server.
Follow the prompts and the language server should get set up correctly.
If you want to manually install/update the language server,
- Ensure you have set `go.useLanguageServer` to `true` in your settings
- Use the `Go: Install/Update Tools` command, select `gopls` from the list and press Ok.


#### Settings to control the use of the Go language server

Below are the settings you can use to control the use of the language server. You need to reload the VS Code window for any changes in these settings to take effect.

- Set `go.useLanguageServer` to `true` to enable the use of language server.
- When using `gopls`, see the [recommended settings](https://github.com/golang/tools/blob/master/gopls/doc/vscode.md).
- Some of the features from the language server can be disabled if needed using the setting `go.languageServerExperimentalFeatures`. Below are the features you can thus control. By default, all are set to `true` i.e are enabled.
```json
  "go.languageServerExperimentalFeatures": {
    "format": true,
    "diagnostics": true,
    "documentLink": true
  }
```
- Set `"go.languageServerFlags": ["-logfile", "path to a text file that exists"]` to collect logs in a log file.
- Set `"go.languageServerFlags": ["-rpc.trace"]` to see the complete rpc trace in the output panel (`View` -> `Output` -> `gopls`)

#### Provide feedback on gopls

If you find any problems using the `gopls` language server, please first check the [list of existing issues for gopls](https://github.com/golang/go/issues?q=is%3Aissue+is%3Aopen+label%3Agopls) and update the relevant ones with your case before logging a new one at https://github.com/golang/go/issues


#### Helpful links for gopls

- [Wiki for gopls](https://github.com/golang/tools/blob/master/gopls/doc/user.md)
- [Recommended settings for VSCode when using gopls](https://github.com/golang/tools/blob/master/gopls/doc/vscode.md)
- [Troubleshooting for gopls](https://github.com/golang/go/wiki/gopls#troubleshooting)
- [Known bugs with gopls](https://github.com/golang/go/wiki/gopls#known-issues)
- [Github issues for gopls](https://github.com/golang/go/issues?q=is%3Aissue+is%3Aopen+label%3Agopls)

### Linter

A linter is a tool giving coding style feedback and suggestions.
By default this extension uses the official [golint](https://github.com/golang/lint) as a linter.

You can change the default linter and use the more advanced [golangci-lint](https://github.com/golangci/golangci-lint)
by setting `go.lintTool` to "golangci-lint" in your settings. It shares some of the performance
characteristics of megacheck, but supports a broader range of tools.
You can configure golangci-lint with `go.lintFlags`, for example to show issues only in new code and to enable all linters:

```javascript
  "go.lintFlags": ["--enable-all", "--new"],
```

You can also use [staticcheck](https://github.com/dominikh/go-tools/tree/master/cmd/staticcheck).

Another alternative of golint is [revive](https://github.com/mgechev/revive). It is extensible, configurable, provides superset of the rules of golint, and has significantly better performance.

To configure revive, use:

```javascript
  "go.lintFlags": ["-exclude=vendor/...", "-config=${workspaceFolder}/config.toml"]
```

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
* `Go: Generate Unit Tests For Package` Generates unit tests for the current package
* `Go: Generate Unit Tests For File` Generates unit tests for the current file
* `Go: Generate Unit Tests For Function` Generates unit tests for the selected function in the current file
* `Go: Install Tools` Installs/updates all the Go tools that the extension depends on
* `Go: Add Tags` Adds configured tags to selected struct fields.
* `Go: Remove Tags` Removes configured tags from selected struct fields.
* `Go: Generate Interface Stubs` Generates method stubs for given interface
* `Go: Fill Struct` Fills struct literal with default values
* `Go: Run on Go Playground` Upload the current selection or file to the Go Playground

You can access all of the above commands from the command palette (`Cmd+Shift+P` or `Ctrl+Shift+P`).

A few of these are available in the editor context menu as an experimental feature as well. To control which of these commands show up in the editor context menu, update the setting `go.editorContextMenuCommands`.


### _Optional_: Debugging

To use the debugger, you must currently manually [install delve](https://github.com/derekparker/delve/tree/master/Documentation/installation). For more read [Debugging Go Code Using VS Code](https://github.com/Microsoft/vscode-go/wiki/Debugging-Go-code-using-VS-Code).

#### Debugging in WSL

If using WSL on Windows, you will need the WSL 2 Linux kernel.  See [WSL 2 Installation](https://docs.microsoft.com/en-us/windows/wsl/wsl2-install) and note the Window 10 build version requirements. 

#### Remote Debugging

To remote debug using VS Code, read [Remote Debugging](https://github.com/Microsoft/vscode-go/wiki/Debugging-Go-code-using-VS-Code#remote-debugging).

## Install or update all dependencies

To quickly get all dependencies installed (or updated) see the [Go Tools wiki page](https://github.com/Microsoft/vscode-go/wiki/Go-tools-that-the-Go-extension-depends-on).

## Building and Debugging the Extension

You can set up a development environment for debugging the extension during extension development.
Read more at [Building, Debugging and Sideloading the extension in Visual Studio Code](https://github.com/Microsoft/vscode-go/wiki/Building,-Debugging-and-Sideloading-the-extension-in-Visual-Studio-Code).

## Tools this extension depends on

This extension uses a host of Go tools to provide the various rich features. These tools are installed in your GOPATH by default. If you wish to have the extension use a separate GOPATH for its tools, provide the desired location in the setting `go.toolsGopath`. Read more about this and the tools at [Go tools that the Go extension depends on](https://github.com/Microsoft/vscode-go/wiki/Go-tools-that-the-Go-extension-depends-on).

## Frequently Asked Questions (FAQ)

Please see our wiki on [Frequently Asked Questions](https://github.com/Microsoft/vscode-go/wiki/Go-with-VS-Code-FAQ-and-Troubleshooting) to get answers to your questions or get started with troubleshooting.

## Contributing

This project welcomes contributions and suggestions. Please go through our [Contributing Guide](https://github.com/Microsoft/vscode-go/blob/master/CONTRIBUTING.md)
to learn how you can contribute. It also includes details on the Contributor License Agreement.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License
[MIT](LICENSE)
