---
name: Bug report
about: Create a report to help us improve
title: ''
labels: ''
assignees: ''

---

Please direct general questions to:
- [Gitter](https://gitter.im/Microsoft/vscode-go)
- [Gophers Slack](https://invite.slack.golangbridge.org/messages/vscode)

Please review the [Wiki](https://github.com/microsoft/vscode-go/wiki) before filing an issue.
Helpful pages include:
- [GOPATH](https://github.com/Microsoft/vscode-go/wiki/GOPATH-in-the-VS-Code-Go-extension)
- [Module Support](https://github.com/microsoft/vscode-go/wiki/Go-modules-support-in-Visual-Studio-Code)
- [Debugging](https://github.com/Microsoft/vscode-go/wiki/Debugging-Go-code-using-VS-Code)
	- Set "trace": "log" and share the resulting logs in the debug console when logging an issue.

Please answer these questions before submitting your issue. Thanks!

### What version of Go, VS Code & VS Code Go extension are you using?
- Run `go version` to get version of Go
	- <Paste go version here>
- Run `code -v` or `code-insiders -v` to get version of VS Code or VS Code Insiders
	- <Paste VS Code version here>
- Check your installed extensions to get the version of the VS Code Go extension 
	- <Paste Go extension version here>
- Run `go env GOOS GOARCH` to get the operating system and processor architecture details
	- <Paste OS and arch details here>

### Share the Go related settings you have added/edited

Run `Preferences: Open Settings (JSON)` command to open your settings.json file.
Share all the settings with the `go.` or `["go"]` prefixes.

### Describe the bug
A clear and concise description of what the bug.
A clear and concise description of what you expected to happen.

### Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

### Screenshots or recordings
If applicable, add screenshots or recordings to help explain your problem.


