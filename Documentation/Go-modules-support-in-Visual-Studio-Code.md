VS Code uses a host of [Go tools](https://github.com/Microsoft/vscode-go/wiki/Go-tools-that-the-Go-extension-depends-on) to provide features like code navigation, code completion, build, lint etc. 

> ⚠️ These tools **do not** provide a good support for [Go modules](https://blog.golang.org/modules2019) yet. 

The new language server [gopls](https://github.com/golang/go/wiki/gopls) does support modules. Add the below in your [settings](https://code.visualstudio.com/docs/getstarted/settings) to use it.

```json
"go.useLanguageServer": true
```

> **Note**: You will be prompted to install the latest stable version of `gopls` as and when the Go tools team tag a new version as stable.

Known issues in VS Code when using `gopls`:

- Completion of unimported packages doesnt work
- Find references and rename only work in a single package
- For more, see 
    - [Known issues with gopls](https://github.com/golang/go/wiki/gopls#known-issues) 
	- Issues in this repo with the label [go-modules](https://github.com/Microsoft/vscode-go/issues?q=is%3Aopen+is%3Aissue+label%3Ago-modules)

To troubleshoot the language server, please see [Troubleshooting gopls](https://github.com/golang/go/wiki/gopls#troubleshooting)


If you don't want to use the language server for any reason, then please know that not all the [Go tools](https://github.com/Microsoft/vscode-go/wiki/Go-tools-that-the-Go-extension-depends-on) that this extension depends on supports Go modules. https://github.com/golang/go/issues/24661 is the issue used by the Go tools team to track the update of Go modules support in various Go tools.

## FAQ

### Can I use the language server when using Go modules?

Yes, you can and this is the path forward for module support in VS Code. Please be aware that the language server itself is in alpha mode with active development in progress. See the section right above this question for details.

### Why is code navigation and code completion slow when using Go modules?

Code navigation and code completion definitely works better when using the language server from Google. So, please give that a try. 

If you are not using the language server, then this is mostly due to the limitation of the tools that power these features which are `godef` and `gocode` respectively. The Go tools team at Google are working on a [language server](https://godoc.org/golang.org/x/tools/cmd/gopls) which will be the long term solution for all language features.

Please try out the language server as described in the first section of this page.
If you don't want to use the language server then,
- For slowness in code completion, log an issue in the [gocode repo](https://github.com/stamblerre/gocode).
- For slowness in code navigation, log an issue in the [godef repo](https://github.com/rogpeppe/godef) or if you chosen to `gogetdoc` in your settings, then log an issue in the [gogetdoc repo](https://github.com/zmb3/gogetdoc)

### Auto import no longer happens on file save. Why?

If you are not using the language server, this extension uses [goreturns](https://github.com/sqs/goreturns) tool by default to format your files and auto import missing packages. Since this tool doesn't support modules, the auto import feature on file save no longer works.

Add the setting `"go.formatTool": "goimports"` and then use `Go: Install/Update Tools` to install/update `goimports` as it has recently added support for modules.




