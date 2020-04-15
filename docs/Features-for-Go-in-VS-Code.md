### IntelliSense

- Auto Completion of symbols as you type (using `gocode`)
- Signature Help for functions as you type (using `gogetdoc` or `godef`+`godoc`)
- Quick Info on the symbol as you hover over it (using `gogetdoc` or `godef`+`godoc`)

### Code Navigation

- Go to or Peek Definition of symbols (using `gogetdoc` or `godef`+`godoc`)
- Find References of symbols and Implementations of interfaces (using `guru`)
- Go to symbol in file or see the file outline (using `go-outline`)
- Go to symbol in workspace (using `go-symbols`)
- Toggle between a Go program and the corresponding test file.

### Code Editing

- Code Snippets for quick coding
- Format code on file save as well as format manually (using `goreturns` or `goimports` or `gofmt`)
- Symbol Rename (using `gorename`. Note: For Undo after rename to work in Windows you need to have `diff` tool in your path)
- Add Imports to current file (using `gopkgs`)
- Add/Remove Tags on struct fields (using `gomodifytags`)
- Generate method stubs for interfaces (using `impl`)
- Fill struct literals with default values (using `fillstruct`)

### Diagnostics

- Build-on-save to compile code and show build errors. (using `go build` and `go test`)
- Vet-on-save to run `go vet` and show errors as warnings
- Lint-on-save to show linting errors as warnings (using `golint`, `gometalinter`, `megacheck`, `golangci-lint` or `revive`)
- Semantic/Syntactic error reporting as you type (using `gotype-live`)

### Testing

- Run Tests under the cursor, in current file, in current package, in the whole workspace using either commands or codelens 
- Run Benchmarks under the cursor using either commands or codelens
- Show code coverage either on demand or after running tests in the package.
- Generate unit tests skeleton (using `gotests`)