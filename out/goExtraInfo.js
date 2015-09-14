/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';
define(["require", "exports", 'child_process'], function (require, exports, cp) {
    var ExtraInfoSupport = (function () {
        function ExtraInfoSupport(modelService) {
            this.modelService = modelService;
        }
        ExtraInfoSupport.prototype.computeInfo = function (resource, position, token) {
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
                        if (lines.length > 10)
                            lines[9] = "...";
                        var text = lines.slice(1, 10).join('\n');
                        return resolve({
                            htmlContent: [
                                { formattedText: text }
                            ],
                            range: {
                                startLineNumber: position.lineNumber,
                                startColumn: wordAtPosition ? wordAtPosition.startColumn : position.column,
                                endLineNumber: position.lineNumber,
                                endColumn: wordAtPosition ? wordAtPosition.endColumn : position.column
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
        return ExtraInfoSupport;
    })();
    return ExtraInfoSupport;
});
//# sourceMappingURL=goExtraInfo.js.map