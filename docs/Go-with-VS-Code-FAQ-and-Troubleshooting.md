## FAQ

**Q: I installed the plugin, but none of the features are working. Why?**

**A:** Make sure to install all the dependent Go tools. Run `Go: Install/Update Tools`. If you want to install only selected tools, then go through the [Go tools that this plugin depends on](https://github.com/Microsoft/vscode-go/wiki/Go-tools-that-the-Go-extension-depends-on) and install the ones you need manually

If you see an error of the form `command <command-name-here> not found`, it means that the extension has failed to activate and register its commands. Please try to uninstall and re-install the extension.

**Q: I see "git pull --ff-only" errors when installing tools.**

**A:** Chances are that there was a force pushed commit to the repo for the tool being installed. Delete the folder corresponding to this tool in your `$GOPATH/src` (if you have set `go.toolsGopath`, then check there) and try again.

**Q: Why do my imported packages keep getting removed or re-ordered?**

**A:** By default, the plugin formats your code and organizes your imports (add missing imports, remove unused imports, order imports) on each file save. You can disable this feature using settings.
- If not using the `gopls` language server, then either add `"go.formatTool": "gofmt"` to your settings to choose a formatting tool that doesn't touch imports or disable the format on save feature entirely using the below
```json
"[go]": {
   "editor.formatOnSave": false
}
```
- If you are using the `gopls` language server, then the organizing of imports is pulled out of the formatting process. To disable the organizing of imports in this case, add the below in your settings
```
"[go]": {
    "editor.codeActionsOnSave": {
      "source.organizeImports": false
    }
  }
```

**Q: Why do my spaces keep getting replaced with tabs when saving the file?**

**A:** Because the formatting tools used by this extension either `goreturns`, `goimports` or `gofmt` all follow the rule of using tabs instead of spaces.

**Q: Shoudln't the formatting tools be using a tab size of 8?**

**A:** The default tab size in VS Code is 4. To change this to 8 for Go files, add the below to your settings.
```json
"[go]": {
  "editor.tabSize": 8
}
```

**Q: How does the plugin determine the GOPATH to use?**

**A:** See [GOPATH in the VS Code Go extension](https://github.com/Microsoft/vscode-go/wiki/GOPATH-in-the-VS-Code-Go-extension)

**Q: Does VS Code support Go modules?**

**A:** See [Go modules support in VS Code](https://github.com/Microsoft/vscode-go/wiki/Go-modules-support-in-Visual-Studio-Code)

**Q: Why is code navigation and code completion slow when using Go modules?**

Please see [Go modules support in VS Code](https://github.com/Microsoft/vscode-go/wiki/Go-modules-support-in-Visual-Studio-Code)

**Q: Can I use language server when using Go modules?**

**A:** Yes! Please see [Go language server in VS Code](https://github.com/Microsoft/vscode-go#go-language-server)

**Q: How do I just run my code? Not debug, just run.**

**A:** Use the keybinding `Ctrl+F5` or run the command `Debug: Start without Debugging`.

Behind the scenes, we use `go run` command which takes a file path. Therefore, If you already have a `launch.json` file with default configuration, update it to use `${file}` instead of `${fileDirname}` instead. If you are using your own debug configuration, ensure that the `program` property needs to point to a file and not directory.

In the absence of a file path in the `program` property, `Start without Debugging` falls back to normal debugging

**Q: Why is the GOPATH I set in the integrated terminal not being used by the plugin? Why isn't my program getting the environment variables I set in the integrated terminal?**

**A:** The extensions run in a separate process than the terminal or rest of the VS Code window. Therefore, environment variables set specifically in the integrated terminal is not visible to the extensions.

**Q: Where do I see the logs from the extension?**

**A:** In the `View` menu, select `Output` which will bring up the output panel. In the top right corner of this panel, select `Log (Extension Host)` from the drop down. 
_Tip_: If you are looking for logs after doing a particular operation, first clear the logs and try again to reduce the noise 

**Q: Auto-completions stopped working. What do I do?**
- Check the logs for errors first. See the previous question on how to view logs from the extension.
- If you are using the language server, then the dropdown for output pane in the previous step will have an entry for the language server. Check that out.
- If you are **not** using the language server,
     - and this is for symbols from external packages, then ensure they installed first. You can do this by either running `Go: Build Current Package` which will install all dependencies or install the dependencies manually yourself using `go install`.
     - If it still doesnt work, run `gocode close` or `gocode exit` in a terminal and try again. Use `gocode-gomod` instead of `gocode` if you are using Go modules.
     - If it still doesnt work, run `Go: Install/Update Tools`, choose `gocode` to update the tool. Choose `gocode-gomod` if you are using Go modules
     - If it still doesnt work, run `gocode close` or `gocode exit` followed by `gocode -s -debug` in a terminal and try again. Results from `gocode` will show up in the terminal. Use `gocode-gomod` instead of `gocode` if you are using Go modules.
     - If you see expected results in the terminal, but not in VS Code, log an issue in the [vscode-go](https://github.com/Microsoft/vscode-go) repo, else 
log an issue in the [gocode](https://github.com/mdempsky/gocode) repo. If you are using Go modules, log the issue in https://github.com/stamblerre/gocode

**Q: Why doesn't formatting doesn't work on file save?**

**A:** Check the logs (View -> Output -> Log (Extension Host) from the drop down in the top right corner) for messages like "Formatting took too long" or "Format On Save feature could be aborted". If you find such a message, then chances are formatted was aborted because it took too long and so can affect the save experience. You can control this timeout using the setting `editor.formatOnSaveTimeout`

**Q: My imports have red lines saying "package not found"**

**A:** These are build errors. Go to View -> Output -> Select "Go" from the dropdown on the top right corner of the panel. Here you can see the output of the `go build` (or `go test` if the current file is a test file). Copy the `go build` command along with arguments and try running it in the terminal. If you still see the same errors, then the problem is in your setup of GOPATH. If it runs fine, then log an issue and we can look into it

**Q: How do I get the features/bug fixes that are implemented but not released yet? How do I get the beta version of the Go extension?**

**A:** See [Install the beta version](https://github.com/Microsoft/vscode-go/wiki/Use-the-beta-version-of-the-latest-Go-extension)