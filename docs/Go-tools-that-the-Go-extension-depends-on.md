First, the Go extension for Visual Studio Code requires the Go tools to be already installed.
See [Go's installation guide](https://golang.org/doc/install) and ensure the `go` command is available from your [`PATH`](https://en.wikipedia.org/wiki/PATH_(variable)).

The Go extension for Visual Studio Code offers extra Go tools that are installed in the user's GOPATH. Some of them are responsible for general language features like code navigation, auto-completions, symbol search etc. Others, while helpful, are optional for the Go extension to provide day-to-day language support.

Below are the tools essential for the general features of this extension. If you have chosen to use the [Go language server](https://github.com/microsoft/vscode-go#go-language-server), then most of the below tools are no longer needed as the corresponding features will be provided by the language server. Eventually, once the language server is stable, we will move to using it and deprecate the use of individual tools below.

**NOTE**: If you are using Go modules, then we strongly recommend using the Go language server as it performs much better than the tools below. 

- [gocode](http://github.com/stamblerre/gocode/) for auto-completion 
- [go-outline](https://github.com/ramya-rao-a/go-outline) for symbol search in the current file
- [go-symbols](https://github.com/acroca/go-symbols) for symbol search in the current workspace
- [gopkgs](https://github.com/uudashr/gopkgs) for auto-completion of unimported packages
- [guru](https://golang.org/x/tools/cmd/guru) for the `Find all References` feature
- [gorename](https://golang.org/x/tools/cmd/gorename) for renaming symbols
- [goreturns](https://github.com/sqs/goreturns) or [goimports](https://golang.org/x/tools/cmd/goimports) for formatting code _(not needed if using language server)_
- [godef](https://github.com/rogpeppe/godef) or [gogetdoc](https://github.com/zmb3/gogetdoc) for the `Go to Definition` feature _(not needed if using language server)_
- [godoc](https://golang.org/x/tools/cmd/godoc) or [gogetdoc](https://github.com/zmb3/gogetdoc) for the documentation that appears on hover _(not needed if using language server)_
- [golint](https://golang.org/x/lint/golint) or [megacheck](https://honnef.co/go/tools/) or [golangci-lint](https://github.com/golangci/golangci-lint) or [revive](https://github.com/mgechev/revive) for linting
- [dlv](https://github.com/derekparker/delve/tree/master/cmd/dlv) for debugging

If any of these tools are missing, you will see an "Analysis Tools Missing" warning in the bottom right corner of the editor.  Clicking it will offer to install the missing tools for you.

There are other features of this extension which you most probably wouldn't be using every day. For eg: Generating unit tests or generating stubs for interface or modify tags. The tools used for such features are:

- [gomodifytags](https://github.com/fatih/gomodifytags) for modifying tags on structs
- [goplay](https://github.com/haya14busa/goplay/) for running current file in the Go playground
- [impl](https://github.com/josharian/impl) for generating stubs for interfaces
- [gotype-live](https://github.com/tylerb/gotype-live) for providing diagnostics as you type
- [gotests](https://github.com/cweill/gotests/) for generating unit tests
- [go-langserver](https://github.com/sourcegraph/go-langserver) for using the Go language server by Sourcegraph
- [fillstruct](https://github.com/davidrjenni/reftools/tree/master/cmd/fillstruct) for filling a struct literal with default values

You can install all these tools at once by running the command `Go: Install/Update Tools`. The same command can be used to keep the tools up to date as well as to re-compile in case you change the version of Go being used.

If you wish to have the extension use a separate GOPATH for its tools, provide the desired location in the setting `go.toolsGopath`.

