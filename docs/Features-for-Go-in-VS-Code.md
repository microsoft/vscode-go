**NOTE:** If `go.useLanguageServer` is enabled, many of the following features will be
offered through the Go language server `gopls`.

### IntelliSense

- Auto Completion of symbols as you type (using `gocode` or `gopls`)
- Signature Help for functions as you type (using `gogetdoc` or `godef`+`godoc` or `gopls`)
- Quick Info on the symbol as you hover over it (using `gogetdoc` or `godef`+`godoc` or `gopls`)

### Code Navigation

- Go to or Peek Definition of symbols (using `gogetdoc` or `godef`+`godoc` or `gopls`)
- Find References of symbols and Implementations of interfaces (using `guru` or `gopls`)
- Go to symbol in file or see the file outline (using `go-outline` or `gopls`)
- Go to symbol in workspace (using `go-symbols` or `gopls`)
- Toggle between a Go program and the corresponding test file.

### Code Editing

- Code Snippets for quick coding
- Format code on file save as well as format manually (using `goreturns` or `goimports` or `gofmt` or `gopls`)
- Symbol Rename (using `gorename` or `gopls`. Note: If not using `gopls`, then for undo after rename to work in Windows you need to have `diff` tool in your path)
- Add Imports to current file (using `gopkgs` or `gopls`)
- Add/Remove Tags on struct fields (using `gomodifytags`)
- Generate method stubs for interfaces (using `impl`)
- Fill struct literals with default values (using `fillstruct`)

### Diagnostics

- Build-on-save to compile code and show build errors. (using `go build` and `go test`)
- Vet-on-save to run `go vet` and show errors as warnings (`gopls`)
- Lint-on-save to show linting errors as warnings (using `golint`, `gometalinter`, `megacheck`, `golangci-lint` or `revive` or `gopls`)
- Semantic/Syntactic error reporting as you type (using `gotype-live` or `gopls`)

### Testing

- Run Tests under the cursor, in current file, in current package, in the whole workspace using either commands or codelens 
- Run Benchmarks under the cursor using either commands or codelens
- Show code coverage either on demand or after running tests in the package.
- Generate unit tests skeleton (using `gotests`)