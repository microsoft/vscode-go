/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';
define(["require", "exports", './goDef', './goSuggest', './goExtraInfo', './goDeclaration', './goFormat', './goRename', './goCheck', 'monaco'], function (require, exports, languageDef, SuggestSupport, ExtraInfoSupport, DeclarationSupport, FormattingSupport, RenameSupport, goCheck_1, monaco) {
    monaco.Modes.registerMonarchDefinition('go', languageDef);
    monaco.Modes.SuggestSupport.register('go', new SuggestSupport(monaco.Services.ModelService));
    monaco.Modes.ExtraInfoSupport.register('go', new ExtraInfoSupport(monaco.Services.ModelService));
    monaco.Modes.DeclarationSupport.register('go', new DeclarationSupport(monaco.Services.ModelService));
    monaco.Modes.FormattingSupport.register('go', new FormattingSupport(monaco.Services.ModelService));
    monaco.Modes.RenameSupport.register('go', new RenameSupport(monaco.Services.ModelService));
    function mapSeverityToMonacoSeverity(sev) {
        switch (sev) {
            case "error": return monaco.Services.Severity.Error;
            case "warning": return monaco.Services.Severity.Warning;
            default: return monaco.Services.Severity.Error;
        }
    }
    var watcher = monaco.Services.FileSystemEventService.createWatcher();
    watcher.onFileChange(function (fileSystemEvent) {
        if (fileSystemEvent.resource.fsPath.indexOf('.go') !== -1) {
            goCheck_1.check(fileSystemEvent.resource.fsPath).then(function (errors) {
                monaco.Services.MarkerService.changeAll('go', errors.map(function (error) {
                    var targetResource = monaco.URI.file(error.file);
                    var model = monaco.Services.ModelService.getModel(targetResource);
                    var startColumn = 0;
                    var endColumn = 1;
                    if (model) {
                        var text = model.getValueInRange({
                            startLineNumber: error.line,
                            endLineNumber: error.line,
                            startColumn: 0,
                            endColumn: model.getLineMaxColumn(error.line)
                        });
                        var _a = /^(\s*).*(\s*)$/.exec(text), _ = _a[0], leading = _a[1], trailing = _a[2];
                        startColumn = leading.length + 1;
                        endColumn = text.length - trailing.length + 1;
                    }
                    return {
                        resource: targetResource,
                        marker: {
                            severity: mapSeverityToMonacoSeverity(error.severity),
                            message: error.msg,
                            startLineNumber: error.line,
                            endLineNumber: error.line,
                            startColumn: startColumn,
                            endColumn: endColumn
                        }
                    };
                }));
            }).catch(function (err) {
                monaco.showMessage(monaco.MessageSeverity.Information, "Error: " + err);
            });
        }
    });
});
//# sourceMappingURL=goMain.js.map