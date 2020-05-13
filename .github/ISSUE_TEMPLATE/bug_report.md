---
name: Bug report
about: Create a report to help us improve
title: ''
labels: ''
assignees: ''

---

Please direct general questions to:
- [Gophers Slack](https://invite.slack.golangbridge.org/messages/vscode)

Please review the [documentation](https://github.com/golang/vscode-go/tree/master/docs) before filing an issue.
Helpful pages include:
- [GOPATH](https://github.com/golang/vscode-go/tree/master/docs/GOPATH-in-the-VS-Code-Go-extension.md)
- [Module Support](https://github.com/golang/vscode-go/tree/master/docs/Go-modules-support-in-Visual-Studio-Code.md)
- [Debugging](https://github.com/golang/vscode-go/tree/master/docs/Debugging-Go-code-using-VS-Code.md)
	- Set "trace": "log" and share the resulting logs in the debug console when logging an issue.

Please answer these questions before submitting your issue. Thanks!

### What version of Go, VS Code & VS Code Go extension are you using?
- Run `go version` to get version of Go
	- <Paste go version here>
- Run `code -v` or `code-insiders -v` to get version of VS Code or VS Code Insiders
	- <Paste VS Code version here>
- Check your installed extensions to get the version of the VS Code Go extension 
	- <Paste Go extension version here>
- Run `go env` to get the go development environment details
	- <Paste the output here>

### Share the Go related settings you have added/edited

Run `Preferences: Open Settings (JSON)` command to open your settings.json file.
Share all the settings with the `go.` or `["go"]` or `gopls` prefixes.

### Describe the bug
A clear and concise description of what the bug.
A clear and concise description of what you expected to happen.

### Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

### Screenshots or recordings
If applicable, add screenshots or recordings to help explain your problem.


