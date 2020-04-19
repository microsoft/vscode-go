**Pre-requisites for testing Go extension if you don't already have Go installed and the extension set up**

1. Install [Go](https://golang.org/doc/install#install)
2. Run `go get github.com/golang/example/hello`
3. Sideload the Go extension and open the folder $HOME/go/src/gitHub.com/golang/example in VS Code
4. Open any Go file. You will see "Analysis Tools Missing" in the status bar. Click on it to install the Go tools that the extension needs.

**Features to Smoke Test:**

Try the below features for functions, structs and interfaces from current/std/third party packages
- Goto and Peek Definition 
- Find References 
- Hover Info 

Try the below for functions in built-in (fmt, strings, math etc) and custom packages (stringutil in the hello project)
- Auto complete
- Auto complete for unimported packages 
- Set `go.useCodeSnippetsOnFunctionSuggest` to true and check if code snippets show up for functions 
- Signature Help 

Enable build, vet, lint and format On Save features, make a change in a go file and save. Try both values "package" and "workspace" for the settings.
- The output channel for Go should show build, vet and linting results
- If there were errors, red squiggle lines should show up in the editor
- Remove comments on an exported member (anything whose name starts with a capital letter), and make sure linter asks you to add the comment
- Add tabs and extra lines, remove an import: formatting should fix all of these

Rename
- Rename a local variable, rename should work, file should go to a dirty state
- Rename an exported function (eg: Reverse in the hello project), rename should work across files, all affected files should open and be in dirty state

Add imports
- The command "Go: Add import" should give a list of packages that can be imported.
- Selecting one of these should add an import to the current go file
- Already imported packages in the current file should not show up in the list

Other features:
- File outline 
- Debugging 