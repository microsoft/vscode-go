/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';
define(["require", "exports", 'child_process'], function (require, exports, cp) {
    var FormattingSupport = (function () {
        function FormattingSupport(modelService) {
            this.autoFormatTriggerCharacters = [';', '}', '\n'];
            this.modelService = modelService;
        }
        FormattingSupport.prototype.formatDocument = function (resource, options, token) {
            var _this = this;
            return new Promise(function (resolve, reject) {
                var path = resource.fsPath;
                var model = _this.modelService.getModel(resource);
                // TODO: Should really check if the model is dirty and block formatting
                var process = cp.execFile("goreturns", [path], {}, function (err, stdout, stderr) {
                    try {
                        if (err)
                            return reject("Cannot format due to syntax errors.");
                        var result = stdout.toString();
                        // TODO: Should use `-d` option to get a diff and then compute the
                        // specific edits instead of replace whole buffer
                        var lastLine = model.getLineCount();
                        var lastLineLastCol = model.getLineMaxColumn(lastLine);
                        return resolve([{
                                text: result,
                                range: {
                                    startLineNumber: 1,
                                    startColumn: 1,
                                    endLineNumber: lastLine,
                                    endColumn: lastLineLastCol
                                }
                            }]);
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
        };
        return FormattingSupport;
    })();
    return FormattingSupport;
});
//# sourceMappingURL=goFormat.js.map