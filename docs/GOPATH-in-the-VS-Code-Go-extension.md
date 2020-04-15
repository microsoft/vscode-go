At any point in time, you can run the command `Go: Current GOPATH` to see the GOPATH being used by the extension.

### GOPATH from the environment variable
Out of the box, the extension uses the value of the environment variable `GOPATH`. From Go 1.8 onwards, if no such environment variable is set, then the default GOPATH as deciphered from the command `go env` is used.

### GOPATH from `go.gopath` setting
Setting `go.gopath` in User settings overrides the GOPATH that was derived from the above logic.
Setting `go.gopath` in Workspace settings overrides the one from User settings.
You can set multiple folders as GOPATH in this setting. Note that they should be `;` separated in Windows and `:` separated otherwise.

### GOPATH from `go.inferGopath` setting
Setting `go.inferGopath` overrides the value set in `go.gopath` setting. If `go.inferGopath` is set to true, the extension will try to infer the `GOPATH` from the path of the workspace i.e. the directory opened in `vscode`. It searches upwards in the path for the `src` directory, and sets `GOPATH` to one level above that. It will also include the global GOPATH. Run `go env GOPATH` to find out what your global GOPATH is.

For example, if your project looks like `/aaa/bbb/ccc/src/...`, then opening the directory `/aaa/bbb/ccc/src` (or anything below that) will cause the extension to search upwards, find the `src` component in the path, and set the `GOPATH` to one level above that i.e. `GOPATH=/aaa/bbb/ccc`. 

This setting is useful when you are working on different Go projects which have different GOPATHs. Instead of setting the GOPATH in the workspace settings of each project or setting all the paths as `;`/`:` separated string, you can just set `go.inferGopath` to `true`and the extension uses the right GOPATH automatically.

### GOPATH for installing the Go tools using `go.toolsGopath`

The `go get` command installs Go tools in your GOPATH. To prevent the Go tools from cluttering your GOPATH, use the `go.toolsGopath` setting to provide a separate GOPATH to use just for the Go tools. 

The first time you set `go.toolsGopath`, you will have to run `Go: Install/Update Tools` command so that the Go tools get installed in the provided location.

If `go.toolsGopath` is not set or if the Go tools are not found there, then the Go tools from the GOPATH derived from the logic described in the previous section are used. If not found in there as well, then they are looked for in the paths that are part of the PATH environment variable. 
