/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';
define(["require", "exports", 'child_process', 'path', 'os'], function (require, exports, cp, path, os) {
    function check(filename) {
        var gobuild = new Promise(function (resolve, reject) {
            var tmppath = path.normalize(path.join(os.tmpdir(), "go-code-check"));
            var cwd = path.dirname(filename);
            var args = ["build", "-o", tmppath, "."];
            if (filename.match(/_test.go$/i)) {
                args = ['test', '-copybinary', '-o', tmppath, '-c', '.'];
            }
            var process = cp.execFile("go", args, { cwd: cwd }, function (err, stdout, stderr) {
                try {
                    var lines = stderr.toString().split('\n');
                    var ret = [];
                    for (var i = 1; i < lines.length; i++) {
                        var match = /(.*):(\d+): (.*)/.exec(lines[i]);
                        if (!match)
                            continue;
                        var _ = match[0], file = match[1], lineStr = match[2], msg = match[3];
                        var line = +lineStr;
                        ret.push({ file: path.resolve(cwd, file), line: line, msg: msg, severity: "error" });
                    }
                    resolve(ret);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        var golint = new Promise(function (resolve, reject) {
            var cwd = path.dirname(filename);
            var process = cp.execFile("golint", [filename], { cwd: cwd }, function (err, stdout, stderr) {
                try {
                    var lines = stdout.toString().split('\n');
                    var ret = [];
                    for (var i = 0; i < lines.length; i++) {
                        var match = /(.*):(\d+):(\d+): (.*)/.exec(lines[i]);
                        if (!match)
                            continue;
                        var _ = match[0], file = match[1], lineStr = match[2], colStr = match[3], msg = match[4];
                        var line = +lineStr;
                        ret.push({ file: path.resolve(cwd, file), line: line, msg: msg, severity: "warning" });
                    }
                    resolve(ret);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        var govet = new Promise(function (resolve, reject) {
            var cwd = path.dirname(filename);
            var process = cp.execFile("go", ["tool", "vet", filename], { cwd: cwd }, function (err, stdout, stderr) {
                try {
                    var lines = stdout.toString().split('\n');
                    var ret = [];
                    for (var i = 0; i < lines.length; i++) {
                        var match = /(.*):(\d+): (.*)/.exec(lines[i]);
                        if (!match)
                            continue;
                        var _ = match[0], file = match[1], lineStr = match[2], msg = match[3];
                        var line = +lineStr;
                        ret.push({ file: path.resolve(cwd, file), line: line, msg: msg, severity: "warning" });
                    }
                    resolve(ret);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        return Promise.all([gobuild, golint, govet]).then(function (resultSets) { return [].concat.apply([], resultSets); });
    }
    exports.check = check;
});
//# sourceMappingURL=goCheck.js.map