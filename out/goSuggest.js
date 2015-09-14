/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';
define(["require", "exports", 'child_process'], function (require, exports, cp) {
    function monacoTypeFromGoCodeClass(kind) {
        switch (kind) {
            case "const":
            case "package":
            case "type":
                return 'keyword';
            case "func":
                return 'function';
            case "var":
                return 'field';
        }
        return kind;
    }
    var SuggestSupport = (function () {
        function SuggestSupport(modelService) {
            this.triggerCharacters = ['.'];
            this.excludeTokens = ['string', 'comment', 'numeric'];
            this.modelService = modelService;
        }
        SuggestSupport.prototype.suggest = function (resource, position, token) {
            var _this = this;
            return new Promise(function (resolve, reject) {
                var path = resource.fsPath;
                var model = _this.modelService.getModel(resource);
                // get current word
                var wordAtPosition = model.getWordAtPosition(position);
                var currentWord = '';
                if (wordAtPosition && wordAtPosition.startColumn < position.column) {
                    currentWord = wordAtPosition.word.substr(0, position.column - wordAtPosition.startColumn);
                }
                // compute the file offset for position
                var offset = position.column - 1;
                for (var row = 1; row < position.lineNumber; row++) {
                    offset += model.getLineMaxColumn(row);
                }
                // Spawn `gocode` process
                var process = cp.execFile("gocode", ["-f=json", "autocomplete", path, "c" + offset], {}, function (err, stdout, stderr) {
                    try {
                        if (err)
                            return reject(err);
                        var results = JSON.parse(stdout.toString());
                        var suggestions = results[1].map(function (suggest) {
                            return {
                                label: suggest.name,
                                typeLabel: (suggest.class == "func" ? suggest.type.substring(4) : suggest.type),
                                codeSnippet: suggest.name,
                                type: monacoTypeFromGoCodeClass(suggest.class)
                            };
                        });
                        resolve([{ currentWord: currentWord, suggestions: suggestions }]);
                    }
                    catch (e) {
                        reject(e);
                    }
                });
                process.stdin.end(model.getValue());
            });
        };
        return SuggestSupport;
    })();
    return SuggestSupport;
});
//# sourceMappingURL=goSuggest.js.map