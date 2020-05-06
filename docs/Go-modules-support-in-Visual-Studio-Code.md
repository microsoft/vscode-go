The Go language server [gopls](https://golang.org/s/gopls/README.md) provides support for [Go modules](https://blog.golang.org/modules2019).

Add the below in your [settings](https://code.visualstudio.com/docs/getstarted/settings) to use Go modules.

```json
"go.useLanguageServer": true
```

> **Note**: You will be prompted to install the latest stable version of `gopls` as and when the Go tools team tag a new version as stable.

Extra settings to fine tune `gopls` are available. Please see the [gopls documentation](https://golang.org/s/gopls/doc/vscode.md) for more information and recommended settings.

* [Known issues](https://golang.org/s/gopls/doc/status.md#known-issues) in VS Code when using `gopls`

* [Troubleshooting and reporting issues](https://golang.org/s/gopls/doc/troubleshooting.md)

In addition to the Go language server, VS Code extension may use additional [Go tools](Go-tools-that-the-Go-extension-depends-on.md) to provide features like code navigation, code completion, build, lint etc. Some tools may not have a good support for Go modules yet. Please report [an issue](https://github.com/microsoft/vscode-go/issues/new) if you encounter problems.


If you don't want to use the language server for any reason, then please know that not all the [Go tools](Go-tools-that-the-Go-extension-depends-on.md) that this extension depends on supports Go modules. https://golang.org/issues/24661 is the issue used by the Go tools team to track the update of Go modules support in various Go tools.

## FAQ

### Can I use the language server when using Go modules?

Yes, you can and this is the path forward for module support in VS Code. Please be aware that the language server itself is in alpha mode with active development in progress. See the section right above this question for details.

### Why is code navigation and code completion slow when using Go modules?

Code navigation and code completion definitely works better when using `gopls`. So, please give that a try.

If you are not using the language server, then this is mostly due to the limitation of the tools that power these features which are `godef` and `gocode` respectively. The Go tools team at Google are working on a [language server](https://golang.org/s/gopls/README.md) which will be the long term solution for all language features.

Please try out the language server as described in the first section of this page.

If you don't want to use the language server then,
- For slowness in code completion, log an issue in the [gocode repo](https://github.com/stamblerre/gocode).
- For slowness in code navigation, log an issue in the [godef repo](https://github.com/rogpeppe/godef) or if you chosen to `gogetdoc` in your settings, then log an issue in the [gogetdoc repo](https://github.com/zmb3/gogetdoc)

### Auto import no longer happens on file save. Why?

If you are not using the language server, this extension uses [goreturns](https://github.com/sqs/goreturns) tool by default to format your files and auto import missing packages. Since this tool doesn't support modules, the auto import feature on file save no longer works.

Add the setting `"go.formatTool": "goimports"` and then use `Go: Install/Update Tools` to install/update `goimports` as it has recently added support for modules.

