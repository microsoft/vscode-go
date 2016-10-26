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
