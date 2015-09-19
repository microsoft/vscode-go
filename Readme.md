# Building & Runnings

Step #1: Create a symlink from `typings\vscode.d.ts` to a copy of vscode.d.ts 
in your VS Code enlistment  at `src\vs\vscode.d.ts`.

Step #2: Open an instance of Code at the root of this repo.

Step #3: In the Debug viewliet, select `Launch Extension` and hit play.  
A new instance of Code will launch.  Open your GOPATH folder or a subfolder.

# Tools

- gorename: `go get golang.org/x/tools/cmd/gorename`
- gocode: `go get -u github.com/nsf/gocode`
- goreturns: `go get -u sourcegraph.com/sqs/goreturns`
- godef: `go get -v github.com/rogpeppe/godef`
- golint: `go get -u github.com/golang/lint/golint`
- go-find-references: `go get -v github.com/redefiance/go-find-references`
