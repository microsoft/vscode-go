/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';
define(["require", "exports", 'child_process'], function (require, exports, cp) {
    var RenameSupport = (function () {
        function RenameSupport(modelService) {
            this.modelService = modelService;
        }
        RenameSupport.prototype.rename = function (resource, position, newName, token) {
            var _this = this;
            return new Promise(function (resolve, reject) {
                var path = resource.fsPath;
                var model = _this.modelService.getModel(resource);
                // compute the file offset for position
                var offset = position.column - 1;
                for (var row = 1; row < position.lineNumber; row++) {
                    offset += model.getLineMaxColumn(row);
                }
                // TODO: Should really check if any ".go" files are dirty and block rename
                var process = cp.execFile("gorename", ["-offset", path + ":#" + offset, "-to", newName], {}, function (err, stdout, stderr) {
                    try {
                        if (err)
                            return reject("Cannot rename due to errors: " + err);
                        // TODO: 'gorename' makes the edits in the files out of proc.
                        //       Would be better if we coudl get the list of edits.
                        return resolve({
                            currentName: newName,
                            edits: []
                        });
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
        };
        return RenameSupport;
    })();
    return RenameSupport;
});
//# sourceMappingURL=goRename.js.map