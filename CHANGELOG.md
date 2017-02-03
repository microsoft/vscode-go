## 0.6.53 - 30th January, 2017

### Installation improvements
* [Sam Herrmann (@samherrmann)](https://github.com/samherrmann), [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    *  A new setting `go.toolsGopath` for providing an alternate location to install all the Go tools that the extension depends on, if you don't want them cluttering your GOPATH. [PR 351](https://github.com/Microsoft/vscode-go/pull/351) and [PR 737](https://github.com/Microsoft/vscode-go/pull/737).
        * This is useful when you work on different GOPATHs.
        * Remember to run `Go: Install Tools` command to install the tools to the new location.
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    * All the "Install tool" options (the pop ups you see) and the `Go: Install Tools` command now support `gometalinter` if it is your chosen linting tool. [PR 735](https://github.com/Microsoft/vscode-go/pull/735).
        * Since `gometalinter` internally installs linters and expects them to be in the user's GOPATH, `gometalinter` will get installed to your GOPATH and not the alternate location specified in `go.toolsGopath`

### Build improvements
* [Matt Aimonetti (@mattetti)](https://github.com/mattetti)
    * While building, we now use the `-i` flag (for non main packages) which installs dependent packages, which in turn get used in subsequent builds resulting in faster builds in bigger workspaces. [PR 718](https://github.com/Microsoft/vscode-go/pull/718)
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    * Build errors with no line numbers (for eg. Import cycle) are now displayed in the output window and will be mapped to the first line of the file. [PR 740](https://github.com/Microsoft/vscode-go/pull/740)

### Test improvements
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    * A new setting `go.testFlags` that can be used to run tests. If null, `go.buildFlags` will be used. [PR 482](https://github.com/Microsoft/vscode-go/pull/482)
    * Customize flags for each of the test command by using different keybindings. [PR 482](https://github.com/Microsoft/vscode-go/pull/482). In the below example, `ctrl+shift+t` is bound to run the tests in current file with `-short` flag. The commands here can be `go.test.package`, `go.test.file` or `go.test.cursor`.
	
        ```json
        {
            "key": "ctrl+shift+t",
            "command": "go.test.file",
            "args": {
                "flags": ["-short"]
            },
            "when": "editorTextFocus"
        }
        ```
    * New toggle command `Go: Toggle Test File` that lets you toggle between your Go file and the corresponding test file. Previous commands `Go: Open Test File` and `Go: Open Implementation For Test File` have been deprecated in favor of this new command. [PR 739](https://github.com/Microsoft/vscode-go/pull/739). You can add a keyboard binding to this as below:
	
        ```json
        {
            "key": "ctrl+shift+t",
            "command": "go.toggle.test.file",
            "when": "editorTextFocus && editorLangId == 'go'"
        }
        ```
    * If current file is not a test file, show error message while running test commands, instead of displaying success message. Fixes [#303](https://github.com/Microsoft/vscode-go/issues/303)
* [Marcel Voigt (@nochso)](https://github.com/nochso)
   * Show error message in output window when running test coverage fails. [PR 721](https://github.com/Microsoft/vscode-go/pull/721)

### Debugging improvements
* [Andreas Kuhn (@ankon)](https://github.com/ankon)
   * Honor the `cwd` launch configuration argument. [PR 714](https://github.com/Microsoft/vscode-go/pull/714)
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
   * GOPATH set in the `env` property in `launch.json` will also be used to find `dlv` tool. [PR 725](https://github.com/Microsoft/vscode-go/pull/725).
* [Rob Lourens (@roblourens)](https://github.com/roblourens)
   * New property `trace` in `launch.json` to provide option to have verbose logging while debugging using vscode-debug-logger. [PR 753](https://github.com/Microsoft/vscode-go/pull/753). This will help in diagnosing issues with debugging in the Go extension.


## 0.6.52 - 5th January, 2017
* [Yuwei Ba (@ibigbug)](https://github.com/ibigbug)
    * Use `http.proxy` setting while installing Go tools. [PR 639](https://github.com/Microsoft/vscode-go/pull/639)
* [chronos (@bylevel)](https://github.com/bylevel)
    * Bug [#465](https://github.com/Microsoft/vscode-go/issues/465) Fix file outline when non English comments in file. [PR 699](https://github.com/Microsoft/vscode-go/pull/699)
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    * Implement Step Out in debgging [Commit 6d0f440](https://github.com/Microsoft/vscode-go/commit/6d0f4405330efb789c16a01434cf096f0f9fb29c)
    * Improve performance by reducing number of calls to `godoc`, `godef`, `gogetdoc`. [PR 711](https://github.com/Microsoft/vscode-go/pull/711)
    * Default value for `go.autocompleteUnimportedPackages` is now false to reduce noise in the suggestion list. Members of unimported packages will still show up in suggestion list after typing dot after package name.

## 0.6.51 - 29th November, 2016
* [Jimmy Kuu (@jimmykuu)](https://github.com/jimmykuu)
    *  Remove blank space in the end of code snippet on function suggest. [PR 628](https://github.com/Microsoft/vscode-go/pull/628)
* [Ahmed W. (@OneofOne)](https://github.com/OneOfOne)
    *  Remove the multiple -d flags in formatting. [PR 644](https://github.com/Microsoft/vscode-go/pull/644)
* [Paweł Kowalak (@viru)](https://github.com/viru)
    *  Snippet for Benchmark Test function. [PR 648](https://github.com/Microsoft/vscode-go/pull/648)
* [Alberto García Hierro (@fiam)](https://github.com/fiam)
    *  Fix Go To Definition, Hover and Signature Help when using Go from tip. [PR 655](https://github.com/Microsoft/vscode-go/pull/655)
* [Cedric Lamoriniere (@cedriclam)](https://github.com/cedriclam)
    *  Fix Generate Test for Current function when the function is a method on a type. [PR 657](https://github.com/Microsoft/vscode-go/pull/657)
* [Potter Dai (@PotterDai)](https://github.com/PotterDai)
    *  Fix Find all References when using multiple GOPATH where one is the substring of the other. [PR 658](https://github.com/Microsoft/vscode-go/pull/658)
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    *  Fix autocomplete of unimported versioned packages from gopkg.in [PR 659](https://github.com/Microsoft/vscode-go/pull/659)
    *  Use relative path for vendor packages when the vendor folder is right under $GOPATH/src as well. [PR 660](https://github.com/Microsoft/vscode-go/pull/660)
    *  Fix autocomplete when working with large data. [Bug 640](https://github.com/issues/640). [PR 661](https://github.com/Microsoft/vscode-go/pull/661)

## 0.6.50 - 21st November, 2016
* [lixiaohui (@leaxoy)](https://github.com/leaxoy), [Arnaud Barisain-Monrose (@abarisain)](https://github.com/abarisain), [Zac Bergquist (@zmb3)](https://github.com/zmb3) and [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    * Added option to use `gogetdoc` for Goto Definition , Hover and Signature Help features. [PR 622](https://github.com/Microsoft/vscode-go/pull/622) To use this, add a setting `"go.docstool": "gogetdoc"` to your settings and reload/restart VS Code. This fixes the below bugs
         * [#440](https://github.com/Microsoft/vscode-go/issues/440) Hover info does not show doc string for structs
         * [#442](https://github.com/Microsoft/vscode-go/issues/442) Goto Definition, Hover, Signature Help do not work for `net` package
         * [#496](https://github.com/Microsoft/vscode-go/issues/496) Goto Definition, Hover, Signature Help do not work for Dot imported functions
         * [#515](https://github.com/Microsoft/vscode-go/issues/515) Go to definition and type info doesn't work with mux.Vars or anything else from gorilla/mux
         * [#567](https://github.com/Microsoft/vscode-go/issues/567) Signature Help and Quick Info do not show function comments for unexported functions
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    * Revert changes done in the formatting area in 0.6.48 update. Fixes below bugs
         * [#613](https://github.com/Microsoft/vscode-go/issues/613) Format removes imports of vendored packages in use
         * [#630](https://github.com/Microsoft/vscode-go/issues/630) goreturns fails to consider global variables in package

## 0.6.49 - 10th November, 2016
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    * Revert the deprecation of `go.formatOnSave` due to popular demand.

## 0.6.48 - 9th November, 2016
* [Mark LaPerriere (@marklap)](https://github.com/marklap)
    * Snippets for method declaration, main and init functions [PR 602](https://github.com/Microsoft/vscode-go/pull/602)
* [Rob Lourens @roblourens](https://github.com/roblourens)
    * launch.json intellisense to include all "mode" values. Fixes [#574](https://github.com/Microsoft/vscode-go/issues/574)
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    * Support for `editor.formatOnSave` and deprecating `go.formatOnSave` [PR 578](https://github.com/Microsoft/vscode-go/pull/578)
    * Remove deprecated language configuration settings [PR 587](https://github.com/Microsoft/vscode-go/pull/587)
    * Feature Request [432](https://github.com/Microsoft/vscode-go/issues/432): Commands to switch to test file and back.  [PR 590](https://github.com/Microsoft/vscode-go/pull/590). You can add your own shortcuts for these commands.
         * `Go: Open Test File`
         * `Go: Open Implementation for Test File`
    * Navigate to test file after generating unit tests using the `Go: Generate unit tests ...` commands. [PR 610](https://github.com/Microsoft/vscode-go/pull/610)
    * Prompt to set GOPATH if not set already [PR 591](https://github.com/Microsoft/vscode-go/pull/591)
    * Improvements to auto complete
         * [#389](https://github.com/Microsoft/vscode-go/issues/389) Fix issue with autocomplete popping up at the end of a string [PR 586](https://github.com/Microsoft/vscode-go/pull/586)
         * [#598](https://github.com/Microsoft/vscode-go/issues/598) Importable packages in auto complete should appear after rest of the suggestions. [PR 603](https://github.com/Microsoft/vscode-go/pull/603)
         * [#598](https://github.com/Microsoft/vscode-go/issues/598) Importing vendored packages from other Go projects should not be allowed. [PR 605](https://github.com/Microsoft/vscode-go/pull/605)
         * [#598](https://github.com/Microsoft/vscode-go/issues/598) When there is an identifier with same name as an available package, do not show the package in the compeltion list [PR 608](https://github.com/Microsoft/vscode-go/pull/608)
    * Other Bug Fixes
         * [#592](https://github.com/Microsoft/vscode-go/issues/592) Use Go from GOROOT while installing tools [PR 594](https://github.com/Microsoft/vscode-go/pull/594)
         * [#585](https://github.com/Microsoft/vscode-go/issues/585) Use fs.stat instead of fs.exists to avoid mistaking "go" folder as "go" file [PR 595](https://github.com/Microsoft/vscode-go/pull/595)
         * [#563](https://github.com/Microsoft/vscode-go/issues/563) Dont run `gotests` on non Go files [PR 584](https://github.com/Microsoft/vscode-go/pull/584)

## 0.6.47 - 26th October 2016
* [Rob Lourens @roblourens](https://github.com/roblourens)
    * Fix the regression in debugging [PR #576](https://github.com/Microsoft/vscode-go/pull/576)
* [Ramya Rao(@ramya-rao-a)](https://github.com/ramya-rao-a)
    * Preserve focus in editor when running tests [PR #577](https://github.com/Microsoft/vscode-go/pull/577)

## 0.6.46 - 26th October 2016
* [Ramya Rao(@ramya-rao-a)](https://github.com/ramya-rao-a)
    * Fix issues due to missing version when Go is used from source without release tags [PR #549](https://github.com/Microsoft/vscode-go/pull/549)
    * Use -imports-only option in go-outline tool [PR #550](https://github.com/Microsoft/vscode-go/pull/550)
* [Rob Lourens @roblourens](https://github.com/roblourens)
    * Use random port number while debugging [PR #553](https://github.com/Microsoft/vscode-go/pull/553)

## 0.6.45 - 17th October 2016
* [Ramya Rao(@ramya-rao-a)](https://github.com/ramya-rao-a)
    * Better error message when Go is not found [PR #536](https://github.com/Microsoft/vscode-go/pull/536)
	* Add setting to control use of -d flag by the formatting tool [PR #537](https://github.com/Microsoft/vscode-go/pull/537)
	* Replace full path for vendor packages with relative path [PR #491](https://github.com/Microsoft/vscode-go/pull/491)

## 0.6.44 - 12th October 2016
* [Ludwig Valda Vasquez (@bredov)](https://github.com/bredov)
    * New configuration `go.formatFlags` to pass flags to the formatting tool [PR #461](https://github.com/Microsoft/vscode-go/pull/461)
* [Dan Mace (@@ironcladlou](https://github.com/ironcladlou)
    * New command to execute the last run test. The command is `Go: Test Previous` [PR #478](https://github.com/Microsoft/vscode-go/pull/478)
    * Send test output to a distinct output channel [PR #499](https://github.com/Microsoft/vscode-go/pull/499)
* [Cedric Lamoriniere (@cedriclam)](https://github.com/cedriclam)
    * New commands to generate unit test skeletons using `gotests` tool. Needs Go 1.6 or higher. [PR #489](https://github.com/Microsoft/vscode-go/pull/489)
       * `Go: Generate unit tests for current file`
       * `Go: Generate unit tests for current function`
       * `Go: Generate unit tests for current package`
* [Ramya Rao (@ramya-rao-a)](https://github.com/ramya-rao-a)
    * New configuration `go.testEnVars` to pass environment variables to Go tests [PR #498](https://github.com/Microsoft/vscode-go/pull/498)
    * Changes made to GOROOT and GOPATH via settings now take effect immediately without requiring to reload/restart VS Code [PR #458](https://github.com/Microsoft/vscode-go/pull/458)
    * Go extension ready to use after installing tools without requiring to reload/restart VS Code [PR #457](https://github.com/Microsoft/vscode-go/pull/457)
    * Enable Undo after Rename. [PR #477](https://github.com/Microsoft/vscode-go/pull/477). Needs `diff` tool which is not available on Windows by default. You can install it from [DiffUtils for Windows](http://gnuwin32.sourceforge.net/packages/diffutils.htm)
    * Autocomplete for functions from unimported packages and for unimported packages themselves. To enable this set  `go.autocompleteUnimportedPackages` to true. [PR #497](https://github.com/Microsoft/vscode-go/pull/497)
    * Do not allow to import already imported packages via the `Go: Add Import` command. [PR #508](https://github.com/Microsoft/vscode-go/pull/508)
    * Suggest `gometalinter` to Go 1.5 users since `golint` dropped support for Go 1.5 [PR #509](https://github.com/Microsoft/vscode-go/pull/509)
    * Fix broken installation for `goimports`. [PR #470](https://github.com/Microsoft/vscode-go/pull/470) and [PR #509](https://github.com/Microsoft/vscode-go/pull/509)
* [Arnaud Barisain-Monrose (@abarisain)](https://github.com/abarisain)
    * Fix broken installation for `goreturns` in Windows. [PR #463](https://github.com/Microsoft/vscode-go/pull/463)

## 0.6.43 - August 2016
* [Matt Aimonetti (@mattetti)](https://github.com/mattetti)
    * New command to install/update all Go tools that the Go extension needs. The command is `Go: Install Tools` [PR #428](https://github.com/Microsoft/vscode-go/pull/428)
* [Ryan Veazey (@ryanz)](https://github.com/ryanvz)
    * Auto-generated launch.json to have `showLog:true`. [PR #412](https://github.com/Microsoft/vscode-go/pull/412)
* [Arnaud Barisain-Monrose (@abarisain)](https://github.com/abarisain)
    * Updates to Extra Info feature: Documentation from `godoc` now appears on hover [PR #424](https://github.com/Microsoft/vscode-go/pull/424)

## 0.6.40-42 - July 2016
* [Sajjad Hashemian (@sijad)](https://github.com/sijad)
    * Option to choose `gometalinter` as tool for linting [PR #294](https://github.com/Microsoft/vscode-go/pull/294)
* [Bartosz Wróblewski (@bawr)](https://github.com/bawr)
    * New configuration `showLog` to toggle the debugging output from `delve` [PR #352](https://github.com/Microsoft/vscode-go/pull/352)
* [benclarkwood (@benclarkwood)](https://github.com/benclarkwood)
    * Better logging while installing tools [PR #375](https://github.com/Microsoft/vscode-go/pull/375)
