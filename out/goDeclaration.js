/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';
define(["require", "exports", 'monaco', 'child_process'], function (require, exports, monaco, cp) {
    var DeclartionSupport = (function () {
        function DeclartionSupport(modelService) {
            this.modelService = modelService;
        }
        DeclartionSupport.prototype.findDeclaration = function (resource, position, token) {
            var _this = this;
            return new Promise(function (resolve, reject) {
                var path = resource.fsPath;
                var model = _this.modelService.getModel(resource);
                var wordAtPosition = model.getWordAtPosition(position);
                // compute the file offset for position
                var offset = position.column;
                for (var row = 1; row < position.lineNumber; row++) {
                    offset += model.getLineMaxColumn(row);
                }
                // Spawn `godef` process
                var process = cp.execFile("godef", ["-t", "-i", "-f", path, "-o", offset.toString()], {}, function (err, stdout, stderr) {
                    try {
                        if (err)
                            return resolve(null);
                        var result = stdout.toString();
                        var lines = result.split('\n');
                        var _a = /(.*):(\d+):(\d+)/.exec(lines[0]), _ = _a[0], file = _a[1], line = _a[2], col = _a[3];
                        var definitionResource = monaco.URI.file(file);
                        return resolve({
                            resource: definitionResource,
                            range: {
                                startLineNumber: +line,
                                startColumn: +col,
                                endLineNumber: +line,
                                endColumn: +col + 1
                            }
                        });
                    }
                    catch (e) {
                        reject(e);
                    }
                });
                process.stdin.end(model.getValue());
            });
        };
        return DeclartionSupport;
    })();
    return DeclartionSupport;
});
//# sourceMappingURL=goDeclaration.js.map