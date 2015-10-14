/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/


declare module 'vscode' {

	// TODO@api
	// Naming: Command, Action, ...

	/**
	 * The command callback.
	 */
	export interface CommandCallback {

		/**
		 *
		 */
		<T>(...args:any[]):T | Thenable<T>;
	}

	/**
	 * Namespace for commanding
	 */
	export namespace commands {

		/**
		 * Registers a command that can be invoked via a keyboard shortcut,
		 * an menu item, an action, or directly.
		 *
		 * @param command - The unique identifier of this command
		 * @param callback - The command callback
		 * @param thisArgs - (optional) The this context used when invoking {{callback}}
		 * @return Disposable which unregisters this command on disposal
		 */
		export function registerCommand(command: string, callback: CommandCallback, thisArg?: any): Disposable;

		/**
		 * Register a text editor command that will make edits.
		 * It can be invoked via a keyboard shortcut, a menu item, an action, or directly.
		 *
		 * @param command - The unique identifier of this command
		 * @param callback - The command callback. The {{textEditor}} and {{edit}} passed in are available only for the duration of the callback.
		 * @param thisArgs - (optional) The `this` context used when invoking {{callback}}
		 * @return Disposable which unregisters this command on disposal
		 */
		export function registerTextEditorCommand(command: string, callback: (textEditor:TextEditor, edit:TextEditorEdit) => void, thisArg?: any): Disposable;

		/**
		 * Executes a command
		 *
		 * @param command - Identifier of the command to execute
		 * @param ...rest - Parameter passed to the command function
		 * @return
		 */
		export function executeCommand<T>(command: string, ...rest: any[]): Thenable<T>;
	}

	export interface TextEditorOptions {
		tabSize: number;
		insertSpaces: boolean;
	}

	export class TextDocument {

		constructor(uri: Uri, lines: string[], eol: string, languageId: string, versionId: number, isDirty:boolean);

		/**
		 * Get the associated URI for this document. Most documents have the file:// scheme, indicating that they represent files on disk.
		 * However, some documents may have other schemes indicating that they are not available on disk.
		 */
		getUri(): Uri;

		/**
		 * Returns the file system path of the file associated with this document. Shorthand
		 * notation for ```TextDocument.getUri().fsPath```
		 */
		getPath(): string;

		/**
		 * Is this document representing an untitled file.
		 */
		isUntitled(): boolean;

		isDirty(): boolean;

		save(): Thenable<boolean>;

		/**
		 * The language identifier associated with this document.
		 */
		getLanguageId(): string;

		/**
		 * The version number of this document (it will strictly increase after each change).
		 */
		getVersionId(): number;

		/**
		 * Get the entire text in this document.
		 */
		getText(): string;

		/**
		 * Get the text in a specific range in this document.
		 */
		getTextInRange(range: Range): string;

		/**
		 * Get the text on a specific line in this document.
		 */
		getTextOnLine(line:number): string;

		/**
		 * Ensure a range sticks to the text.
		 */
		validateRange(range:Range): Range;

		/**
		 * Ensure a position sticks to the text.
		 */
		validatePosition(position:Position): Position;

		/**
		 * Get the number of lines in this document.
		 */
		getLineCount(): number;

		/**
		 * Get the maximum column for line {{line}}.
		 */
		getLineMaxColumn(line:number): number;

		/**
		 * Get the word under a certain position. May return null if position is at whitespace, on empty line, etc.
		 */
		getWordRangeAtPosition(position:Position): Range;
	}

	export class Position {

		line: number;

		character: number;

		constructor(line: number, character: number);

		isBefore(other: Position): boolean;

		isBeforeOrEqual(other: Position): boolean;
	}

	export class Range {

		start: Position;

		end: Position;

		constructor(start: Position, end: Position);
		constructor(startLine: number, startColumn: number, endLine:number, endColumn:number);

		contains(positionOrRange: Position | Range): boolean;

		/**
		 * @return `true` iff `start` and `end` are equal
		 */
		isEmpty(): boolean;

		/**
		 * @return `true` iff start and end are on the same line
		 */
		isOneLine(): boolean;
	}

	export class Selection extends Range {

		anchor: Position;

		active: Position;

		constructor(anchor: Position, active: Position);
		constructor(anchorLine: number, anchorColumn: number, activeLine:number, activeColumn:number);

		isReversed(): boolean;
	}

	export class TextEditor {

		constructor(document: TextDocument, selections: Selection[], options: TextEditorOptions);

		dispose();

		/**
		 * Get the document associated with this text editor. The document will be the same for the entire lifetime of this text editor.
		 */
		getTextDocument(): TextDocument;

		/**
		 * Get the primary selection on this text editor. In case the text editor has multiple selections, the first one will be returned.
		 */
		getSelection(): Selection;

		/**
		 * Set the selection on this text editor.
		 */
		setSelection(value: Position | Range | Selection): Thenable<any>;

		/**
		 * Get the selections in this text editor.
		 */
		getSelections(): Selection[];

		/**
		 * Set the selections in this text editor.
		 */
		setSelections(value: Selection[]): Thenable<TextEditor>;

		/**
		 * Get text editor options.
		 */
		getOptions(): TextEditorOptions;

		/**
		 * Change text editor options.
		 */
		setOptions(options: TextEditorOptions): Thenable<TextEditor>;

		/**
		 * Perform an edit on the document associated with this text editor.
		 * The passed in {{editBuilder}} is available only for the duration of the callback.
		 */
		edit(callback:(editBuilder:TextEditorEdit)=>void): Thenable<boolean>;

	}

	/**
	 * A complex edit that will be applied on a TextEditor.
	 * This holds a description of the edits and if the edits are valid (i.e. no overlapping regions, etc.) they can be applied on a Document associated with a TextEditor.
	 */
	export interface TextEditorEdit {
		/**
		 * Replace a certain text region with a new value.
		 */
		replace(location: Position | Range | Selection, value: string): void;

		/**
		 * Insert text at a location
		 */
		insert(location: Position, value: string): void;

		/**
		 * Delete a certain text region.
		 */
		delete(location: Range | Selection): void;

	}

	/**
	 * A universal resource identifier representing either a file on disk on
	 * or another resource, e.g untitled.
	 */
	class Uri {

		constructor();
		static parse(path: string): Uri;
		static file(path: string): Uri;
		static create(path: string): Uri;

		/**
		 * scheme is the 'http' part of 'http://www.msft.com/some/path?query#fragment'.
		 * The part before the first colon.
		 */
		scheme: string;


		/**
		 * authority is the 'www.msft.com' part of 'http://www.msft.com/some/path?query#fragment'.
		 * The part between the first double slashes and the next slash.
		 */
		authority: string;


		/**
		 * path is the '/some/path' part of 'http://www.msft.com/some/path?query#fragment'.
		 */
		path: string;

		/**
		 * query is the 'query' part of 'http://www.msft.com/some/path?query#fragment'.
		 */
		query: string;

		/**
		 * fragment is the 'fragment' part of 'http://www.msft.com/some/path?query#fragment'.
		 */
		fragment: string;

		/**
		 * Retuns a string representing the corresponding file system path of this URI.
		 * Will handle UNC paths and normalize windows drive letters to lower-case. Also
		 * uses the platform specific path separator. Will *not* validate the path for
		 * invalid characters and semantics. Will *not* look at the scheme of this URI.
		 */
		fsPath: string;

		/**
		 * Returns a canonical representation of this URI. The representation and normalization
		 * of a URI depends on the scheme.
		 */
		toString(): string;

		toJSON(): any;
	}

	interface CancellationToken {
		isCancellationRequested: boolean;
		onCancellationRequested: Event<any>;
	}

	class CancellationTokenSource {

		token: CancellationToken;

		cancel(): void;

		dispose(): void;
	}

	/**
	 * Represents a type which can release resources, such
	 * as event listening or a timer.
	 */
	class Disposable {

		/**
		 * Combine many disposables into one.
		 *
		 * @return Returns a new disposable which, upon dispose, will
		 * dispose all provided disposables
		 */
		static of(...disposables: Disposable[]): Disposable;

		/**
		 * Combine many disposable-likes into one. Use this method
		 * when having objects with a dispose function which are not
		 * instances of Disposable.
		 *
		 * @return Returns a new disposable which, upon dispose, will
		 * dispose all provides disposable-likes.
		 */
		static from(...disposableLikes: { dispose: () => any }[]): Disposable;

		/**
		 * Creates a new Disposable calling the provided function
		 * on dispose
		 * @param callOnDispose Function that disposes something
		 */
		constructor(callOnDispose: Function);

		/**
		 * Dispose this object.
		 */
		dispose(): any;
	}

	/**
	 * Represents a typed event.
	 */
	interface Event<T> {

		/**
		 *
		 * @param listener The listener function will be call when the event happens.
		 * @param thisArgs The 'this' which will be used when calling the event listener.
		 * @param disposables An array to which a {{IDisposable}} will be added. The
		 * @return
		 */
		(listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
	}

	/**
	 * A file system watcher notifies about changes to files and folders
	 * on disk. To get an instanceof of a {{FileSystemWatcher}} use
	 * {{workspace.createFileSystemWatcher}}.
	 */
	export interface FileSystemWatcher extends Disposable {

		/**
		 * Happens on file/folder creation.
		 */
		onDidCreate: Event<Uri>;

		/**
		 * Happens on file/folder change.
		 */
		onDidChange: Event<Uri>;

		/**
		 * Happens on file/folder deletion.
		 */
		onDidDelete: Event<Uri>;
	}

	/**
	 *
	 */
	export interface QuickPickOptions {
		/**
		* an optional flag to include the description when filtering the picks
		*/
		matchOnDescription?: boolean;

		/**
		* an optional string to show as place holder in the input box to guide the user what she picks on
		*/
		placeHolder?: string;
	}

	/**
	 *
	 */
	export interface QuickPickItem {
		label: string;
		description: string;
	}

	/**
	 *
	 */
	export interface InputBoxOptions {
		/**
		* The text to display underneath the input box.
		*/
		prompt?: string;

		/**
		* an optional string to show as place holder in the input box to guide the user what to type
		*/
		placeHolder?: string;
	}

	/**
	 *
	 */
	interface LanguageFilter {
		language?: string;
		scheme?: string;
		pattern?: string;
	}

	/**
	 *
	 */
	type LanguageSelector = string|LanguageFilter|(string|LanguageFilter)[];


	/**
	 *
	 */
	interface ReadOnlyMemento {

		/**
		 * @param key The name of a property to read.
		 * @param defaultValue The default value in case the denoted property doesn't exists.
		 * @return
		 */
		getValue<T>(key: string, defaultValue?: T): Thenable<T>;

		/**
		 *
		 */
		getValues<T>(defaultValue?: T): Thenable<T>;
	}

	/**
	 *
	 */
	interface Memento extends ReadOnlyMemento {
		setValue(key: string, value: any): Thenable<void>;
	}

	/**
	 * Represents the severity of diagnostics.
	 */
	export enum DiagnosticSeverity {
		Warning = 1,
		Error = 2
	}

	/**
	 * Represents a location inside a resource, such as a line
	 * inside a text file.
	 */
	export class Location {
		constructor(uri: Uri, range: Selection | Range | Position);
		uri: Uri;
		range: Range;
	}

	/**
	 * Represents a diagnostic, such as a compiler error or warning, along with the location
	 * in which they occurred.
	 */
	export class Diagnostic {

		constructor(severity: DiagnosticSeverity, location: Location, message: string, source?:string);

		severity: DiagnosticSeverity;

		location: Location;

		message: string;

		source: string;
	}

	// TODO@api, TODO@Joh,Ben
	// output channels need to be known upfront (contributes in package.json)
	export interface OutputChannel extends Disposable {
		append(value: string): void;
		appendLine(value: string): void;
		clear(): void;
		reveal(): void;
	}

	export interface ExecutionOptions {
		cwd?: string;
		env?: { [name: string]: any };
	}

	export interface TextEditorSelectionChangeEvent {
		textEditor: TextEditor;
		selections: Selection[];
	}

	export interface TextEditorOptionsChangeEvent {
		textEditor: TextEditor;
		options: TextEditorOptions;
	}

	export interface ITelemetryInfo {
		sessionId: string;
		machineId: string;
		instanceId: string;
	}

	export namespace window {

		export function getActiveTextEditor(): TextEditor;

		export const onDidChangeActiveTextEditor: Event<TextEditor>;

		export const onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;

		export const onDidChangeTextEditorOptions: Event<TextEditorOptionsChangeEvent>;

		export function showInformationMessage(message: string, ...commands: { title: string; command: string | CommandCallback; }[]): Thenable<void>;

		export function showWarningMessage(message: string, ...commands: { title: string; command: string | CommandCallback; }[]): Thenable<void>;

		export function showErrorMessage(message: string, ...commands: { title: string; command: string | CommandCallback; }[]): Thenable<void>;

		export function setStatusBarMessage(message: string, hideAfterSeconds?: number): Disposable;

		export function showQuickPick(items: string[], options?: QuickPickOptions): Thenable<string>;

		export function showQuickPick<T extends QuickPickItem>(items: T[], options?: QuickPickOptions): Thenable<T>;

		/**
		 * Opens an input box to ask the user for input.
		 */
		export function showInputBox(options?: InputBoxOptions): Thenable<string>;

		export function getOutputChannel(name: string): OutputChannel;

		/**
		 * ✂ - don't use. Will be cut soone!
		TODO@api move into a node_module
		 */
		export function runInTerminal(command: string, args: string[], options?: ExecutionOptions): Thenable<any>;
	}

	/**
	 * An event describing a change in the text of a model.
	 */
	export interface TextDocumentContentChangeEvent {
		/**
		 * The range that got replaced.
		 */
		range: Range;
		/**
		 * The length of the range that got replaced.
		 */
		rangeLength: number;
		/**
		 * The new text for the range.
		 */
		text: string;
	}

	export interface TextDocumentChangeEvent {
		document: TextDocument;
		contentChanges: TextDocumentContentChangeEvent[];
	}

	// TODO@api in the future there might be multiple opened folder in VSCode
	// so that we shouldn't make broken assumptions here
	export namespace workspace {

		/**
		 * Creates a file system watcher. A glob pattern that filters the
		 * file events must be provided. Optionally, flags to ignore certain
		 * kind of events can be provided.
		 *
		 * @param globPattern - A glob pattern that is applied to the names of created, changed, and deleted files.
		 * @param ignoreCreateEvents - Ignore when files have been created.
		 * @param ignoreChangeEvents - Ignore when files have been changed.
		 * @param ignoreDeleteEvents - Ignore when files have been deleted.
		 */
		export function createFileSystemWatcher(globPattern: string, ignoreCreateEvents?: boolean, ignoreChangeEvents?: boolean, ignoreDeleteEvents?: boolean): FileSystemWatcher;

		// TODO@api - justify this being here
		export function getPath(): string;

		export function getRelativePath(pathOrUri: string|Uri): string;

		// TODO@api - justify this being here
		export function findFiles(include: string, exclude: string, maxResults?:number): Thenable<Uri[]>;

		/**
		 * save all dirty files
		 */
		export function saveAll(includeUntitled?: boolean): Thenable<boolean>;

		export function getTextDocuments(): TextDocument[];
		export function getTextDocument(resource: Uri): TextDocument;
		export const onDidOpenTextDocument: Event<TextDocument>;
		export const onDidCloseTextDocument: Event<TextDocument>;
		export const onDidChangeTextDocument: Event<TextDocumentChangeEvent>;
		export const onDidSaveTextDocument: Event<TextDocument>;
	}

	export namespace languages {

		/**
		 * Add diagnostics, such as compiler errors or warnings. They will be represented as
		 * squiggles in text editors and in a list of diagnostics.
		 * To remove the diagnostics again, dispose the `Disposable` which is returned
		 * from this function call.
		 *
		 * @param diagnostics Array of diagnostics
		 * @return A disposable the removes the diagnostics again.
		 */
		export function addDiagnostics(diagnostics: Diagnostic[]): Disposable;

		/**
		 *
		 */
		export function addInformationLanguageStatus(language: LanguageSelector|Uri|Uri[], message: string | { octicon: string; message: string;}, command: string | CommandCallback): Disposable;

		/**
		 *
		 */
		export function addWarningLanguageStatus(language: LanguageSelector | Uri | Uri[], message: string | { octicon: string; message: string; }, command: string | CommandCallback): Disposable;

		/**
		 *
		 */
		export function addErrorLanguageStatus(language: LanguageSelector | Uri | Uri[], message: string | { octicon: string; message: string; }, command: string | CommandCallback): Disposable;
	}

	export namespace extensions {

		export function getStateMemento(extensionId: string, global?: boolean): Memento;

		export function getConfigurationMemento(extensionId: string): ReadOnlyMemento;

		export function getExtension(extensionId: string): any;

		export function getTelemetryInfo(): Thenable<ITelemetryInfo>;
	}

	export interface IHTMLContentElement {
		formattedText?:string;
		text?: string;
		className?: string;
		style?: string;
		customStyle?: any;
		tagName?: string;
		children?: IHTMLContentElement[];
		isText?: boolean;
	}

	// --- Begin Monaco.Modes
	module Modes {
		interface ILanguage {
			// required
			name: string;								// unique name to identify the language
			tokenizer: Object;							// map from string to ILanguageRule[]

			// optional
			displayName?: string;						// nice display name
			ignoreCase?: boolean;							// is the language case insensitive?
			lineComment?: string;						// used to insert/delete line comments in the editor
			blockCommentStart?: string;					// used to insert/delete block comments in the editor
			blockCommentEnd?: string;
			defaultToken?: string;						// if no match in the tokenizer assign this token class (default 'source')
			brackets?: ILanguageBracket[];				// for example [['{','}','delimiter.curly']]

			// advanced
			start?: string;								// start symbol in the tokenizer (by default the first entry is used)
			tokenPostfix?: string;						// attach this to every token class (by default '.' + name)
			autoClosingPairs?: string[][];				// for example [['"','"']]
			wordDefinition?: RegExp;					// word definition regular expression
			outdentTriggers?: string;					// characters that could potentially cause outdentation
			enhancedBrackets?: Modes.IRegexBracketPair[];// Advanced auto completion, auto indenting, and bracket matching
		}

		/**
		 * This interface can be shortened as an array, ie. ['{','}','delimiter.curly']
		 */
		interface ILanguageBracket {
			open: string;	// open bracket
			close: string;	// closeing bracket
			token: string;	// token class
		}

		interface ILanguageAutoComplete {
			triggers: string;				// characters that trigger auto completion rules
			match: string|RegExp;			// autocomplete if this matches
			complete: string;				// complete with this string
		}

		interface ILanguageAutoIndent {
			match: string|RegExp; 			// auto indent if this matches on enter
			matchAfter: string|RegExp;		// and auto-outdent if this matches on the next line
		}

		/**
		 * Standard brackets used for auto indentation
		 */
		export interface IBracketPair {
			tokenType:string;
			open:string;
			close:string;
			isElectric:boolean;
		}

		/**
		 * Regular expression based brackets. These are always electric.
		 */
		export interface IRegexBracketPair {
			openTrigger?: string; // The character that will trigger the evaluation of 'open'.
			open: RegExp; // The definition of when an opening brace is detected. This regex is matched against the entire line upto, and including the last typed character (the trigger character).
			closeComplete?: string; // How to complete a matching open brace. Matches from 'open' will be expanded, e.g. '</$1>'
			matchCase?: boolean; // If set to true, the case of the string captured in 'open' will be detected an applied also to 'closeComplete'.
								// This is useful for cases like BEGIN/END or begin/end where the opening and closing phrases are unrelated.
								// For identical phrases, use the $1 replacement syntax above directly in closeComplete, as it will
								// include the proper casing from the captured string in 'open'.
								// Upper/Lower/Camel cases are detected. Camel case dection uses only the first two characters and assumes
								// that 'closeComplete' contains wors separated by spaces (e.g. 'End Loop')

			closeTrigger?: string; // The character that will trigger the evaluation of 'close'.
			close?: RegExp; // The definition of when a closing brace is detected. This regex is matched against the entire line upto, and including the last typed character (the trigger character).
			tokenType?: string; // The type of the token. Matches from 'open' or 'close' will be expanded, e.g. 'keyword.$1'.
							   // Only used to auto-(un)indent a closing bracket.
		}

		/**
		 * Definition of documentation comments (e.g. Javadoc/JSdoc)
		 */
		export interface IDocComment {
			scope: string; // What tokens should be used to detect a doc comment (e.g. 'comment.documentation').
			open: string; // The string that starts a doc comment (e.g. '/**')
			lineStart: string; // The string that appears at the start of each line, except the first and last (e.g. ' * ').
			close?: string; // The string that appears on the last line and closes the doc comment (e.g. ' */').
		}

		// --- Begin InplaceReplaceSupport
		/**
		 * Interface used to navigate with a value-set.
		 */
		interface IInplaceReplaceSupport {
			sets: string[][];
		}
		var InplaceReplaceSupport: {
			register(modeId: string, inplaceReplaceSupport: Modes.IInplaceReplaceSupport): Disposable;
		};
		// --- End InplaceReplaceSupport


		// --- Begin TokenizationSupport
		enum Bracket {
			None = 0,
			Open = 1,
			Close = -1
		}
		// --- End TokenizationSupport

		// --- Begin IDeclarationSupport
		export interface IDeclarationSupport {
			tokens?: string[];
			findDeclaration(document: TextDocument, position: Position, token: CancellationToken): Thenable<IReference>;
		}
		var DeclarationSupport: {
			register(modeId: string, declarationSupport: IDeclarationSupport): Disposable;
		};
		// --- End IDeclarationSupport

		// --- Begin ICodeLensSupport
		export interface ICodeLensSupport {
			findCodeLensSymbols(document: TextDocument, token: CancellationToken): Thenable<ICodeLensSymbol[]>;
			findCodeLensReferences(document: TextDocument, requests: ICodeLensSymbolRequest[], token: CancellationToken): Thenable<ICodeLensReferences>;
		}
		export interface ICodeLensSymbolRequest {
			position: Position;
			languageModeStateId?: number;
		}
		export interface ICodeLensSymbol {
			range: Range;
		}
		export interface ICodeLensReferences {
			references: IReference[][];
			languageModeStateId?: number;
		}
		var CodeLensSupport: {
			register(modeId: string, codeLensSupport: ICodeLensSupport): Disposable;
		};
		// --- End ICodeLensSupport

		// --- Begin IOccurrencesSupport
		export interface IOccurrence {
			kind?:string;
			range:Range;
		}
		export interface IOccurrencesSupport {
			findOccurrences(resource: TextDocument, position: Position, token: CancellationToken): Thenable<IOccurrence[]>;
		}
		var OccurrencesSupport: {
			register(modeId: string, occurrencesSupport:IOccurrencesSupport): Disposable;
		};
		// --- End IOccurrencesSupport

		// --- Begin IOutlineSupport
		export interface IOutlineEntry {
			label: string;
			type: string;
			icon?: string; // icon class or null to use the default images based on the type
			range: Range;
			children?: IOutlineEntry[];
		}
		export interface IOutlineSupport {
			getOutline(document: TextDocument, token: CancellationToken): Thenable<IOutlineEntry[]>;
			outlineGroupLabel?: { [name: string]: string; };
		}
		var OutlineSupport: {
			register(modeId: string, outlineSupport:IOutlineSupport): Disposable;
		};
		// --- End IOutlineSupport

		// --- Begin IOutlineSupport
		export interface IQuickFix {
			label: string;
			id: any;
			score: number;
			documentation?: string;
		}

		export interface IQuickFixResult {
			edits: IResourceEdit[];
		}

		 export interface IQuickFixSupport {
			getQuickFixes(resource: TextDocument, marker: Range, token: CancellationToken): Thenable<IQuickFix[]>;
			runQuickFixAction(resource: TextDocument, range: Range, id: any, token: CancellationToken): Thenable<IQuickFixResult>;
		}
		var QuickFixSupport: {
			register(modeId: string, quickFixSupport:IQuickFixSupport): Disposable
		};
		// --- End IOutlineSupport

		// --- Begin IReferenceSupport
		export interface IReferenceSupport {
			tokens?: string[];

			/**
			 * @returns a list of reference of the symbol at the position in the
			 * 	given resource.
			 */
			findReferences(document: TextDocument, position: Position, includeDeclaration: boolean, token: CancellationToken): Thenable<IReference[]>;
		}
		var ReferenceSupport: {
			register(modeId: string, quickFixSupport:IReferenceSupport): Disposable;
		};
		// --- End IReferenceSupport

		// --- Begin IParameterHintsSupport
		export interface IParameter {
			label:string;
			documentation?:string;
			signatureLabelOffset?:number;
			signatureLabelEnd?:number;
		}

		export interface ISignature {
			label:string;
			documentation?:string;
			parameters:IParameter[];
		}

		export interface IParameterHints {
			currentSignature:number;
			currentParameter:number;
			signatures:ISignature[];
		}

		export interface IParameterHintsSupport {
			/**
			 * On which characters presses should parameter hints be potentially shown.
			 */
			triggerCharacters: string[];

			/**
			 * A list of token types that prevent the parameter hints from being shown (e.g. comment, string)
			 */
			excludeTokens: string[];
			/**
			 * @returns the parameter hints for the specified position in the file.
			 */
			getParameterHints(document: TextDocument, position: Position, token: CancellationToken): Thenable<IParameterHints>;
		}
		var ParameterHintsSupport: {
			register(modeId: string, parameterHintsSupport:IParameterHintsSupport): Disposable;
		};
		// --- End IParameterHintsSupport

		// --- Begin IExtraInfoSupport
		export interface IComputeExtraInfoResult {
			range: Range;
			value?: string;
			htmlContent?: IHTMLContentElement[];
			className?: string;
		}
		export interface IExtraInfoSupport {
			computeInfo(document: TextDocument, position: Position, token: CancellationToken): Thenable<IComputeExtraInfoResult>;
		}
		var ExtraInfoSupport: {
			register(modeId: string, extraInfoSupport:IExtraInfoSupport): Disposable;
		};
		// --- End IExtraInfoSupport

		// --- Begin IRenameSupport
		export interface IRenameResult {
		    currentName: string;
		    edits: IResourceEdit[];
		    rejectReason?: string;
		}
		export interface IRenameSupport {
			filter?: string[];
			rename(document: TextDocument, position: Position, newName: string, token: CancellationToken): Thenable<IRenameResult>;
		}
		var RenameSupport: {
			register(modeId: string, renameSupport:IRenameSupport): Disposable;
		};
		// --- End IRenameSupport

		// --- Begin IFormattingSupport
		/**
		 * Interface used to format a model
		 */
		export interface IFormattingOptions {
			tabSize:number;
			insertSpaces:boolean;
		}
		/**
		 * A single edit operation, that acts as a simple replace.
		 * i.e. Replace text at `range` with `text` in model.
		 */
		export interface ISingleEditOperation {
			/**
			 * The range to replace. This can be empty to emulate a simple insert.
			 */
			range: Range;
			/**
			 * The text to replace with. This can be null to emulate a simple delete.
			 */
			text: string;
		}
		/**
		 * Supports to format source code. There are three levels
		 * on which formatting can be offered:
		 * (1) format a document
		 * (2) format a selectin
		 * (3) format on keystroke
		 */
		export interface IFormattingSupport {
			formatDocument: (document: TextDocument, options: IFormattingOptions, token: CancellationToken) => Thenable<ISingleEditOperation[]>;
			formatRange?: (document: TextDocument, range: Range, options: IFormattingOptions, token: CancellationToken) => Thenable<ISingleEditOperation[]>;
			autoFormatTriggerCharacters?: string[];
			formatAfterKeystroke?: (document: TextDocument, position: Position, ch: string, options: IFormattingOptions, token: CancellationToken) => Thenable<ISingleEditOperation[]>;
		}
		var FormattingSupport: {
			register(modeId: string, formattingSupport:IFormattingSupport): Disposable;
		};
		// --- End IRenameSupport

		// --- Begin ISuggestSupport
		export interface ISortingTypeAndSeparator {
			type: string;
			partSeparator?: string;
		}
		export interface IHighlight {
			start:number;
			end:number;
		}
		export interface ISuggestion {
			label: string;
			codeSnippet: string;
			type: string;
			highlights?: IHighlight[];
			typeLabel?: string;
			documentationLabel?: string;
		}
		export interface ISuggestions {
			currentWord:string;
			suggestions:ISuggestion[];
			incomplete?: boolean;
			overwriteBefore?: number;
			overwriteAfter?: number;
		}
		export interface ISuggestSupport {
			triggerCharacters: string[];
			excludeTokens: string[];

			sortBy?: ISortingTypeAndSeparator[];

			suggest: (document: TextDocument, position: Position, token: CancellationToken) => Thenable<ISuggestions[]>;
			getSuggestionDetails? : (document: TextDocument, position: Position, suggestion:ISuggestion, token: CancellationToken) => Thenable<ISuggestion>;
		}
		var SuggestSupport: {
			register(modeId:string, suggestSupport:ISuggestSupport): Disposable;
		};
		// --- End ISuggestSupport

		// --- Start INavigateTypesSupport

		export interface ITypeBearing {
			containerName: string;
			name: string;
			parameters: string;
			type: string;
			range: Range;
			resourceUri: Uri;
		}

		export interface INavigateTypesSupport {
			getNavigateToItems:(search: string, token: CancellationToken) => Thenable<ITypeBearing[]>;
		}
		var NavigateTypesSupport: {
			register(modeId:string, navigateTypeSupport:INavigateTypesSupport): Disposable;
		};

		// --- End INavigateTypesSupport

		// --- Begin ICommentsSupport
		export interface ICommentsSupport {
			commentsConfiguration: ICommentsConfiguration;
		}
		export interface ICommentsConfiguration {
			lineCommentTokens?:string[];
			blockCommentStartToken?:string;
			blockCommentEndToken?:string;
		}
		var CommentsSupport: {
			register(modeId:string, commentsSupport:ICommentsSupport): Disposable;
		};
		// --- End ICommentsSupport

		// --- Begin ITokenTypeClassificationSupport
		export interface ITokenTypeClassificationSupport {
			wordDefinition?: RegExp;
		}
		var TokenTypeClassificationSupport: {
			register(modeId:string, tokenTypeClassificationSupport:ITokenTypeClassificationSupport): Disposable;
		};
		// --- End ITokenTypeClassificationSupport

		// --- Begin IElectricCharacterSupport
		export interface IElectricCharacterSupport {
			brackets: IBracketPair[];
			regexBrackets?: IRegexBracketPair[];
			docComment?: IDocComment;
			caseInsensitive?: boolean;
			embeddedElectricCharacters?: string[];
		}
		var ElectricCharacterSupport: {
			register(modeId:string, electricCharacterSupport:IElectricCharacterSupport): Disposable;
		};
		// --- End IElectricCharacterSupport

		// --- Begin ICharacterPairSupport
		export interface ICharacterPairSupport {
			autoClosingPairs: IAutoClosingPairConditional[];
			surroundingPairs?: IAutoClosingPair[];
		}
		/**
		 * Interface used to support insertion of matching characters like brackets and qoutes.
		 */
		export interface IAutoClosingPair {
			open:string;
			close:string;
		}
		export interface IAutoClosingPairConditional extends IAutoClosingPair {
			notIn?: string[];
		}
		var CharacterPairSupport: {
			register(modeId:string, characterPairSupport:ICharacterPairSupport): Disposable;
		};
		// --- End ICharacterPairSupport

		// --- Begin IOnEnterSupport
		export interface IBracketPair2 {
			open: string;
			close: string;
		}
		export interface IIndentationRules {
			decreaseIndentPattern: RegExp;
			increaseIndentPattern: RegExp;
			indentNextLinePattern?: RegExp;
			unIndentedLinePattern?: RegExp;
		}
		export enum IndentAction {
			None,
			Indent,
			IndentOutdent,
			Outdent
		}
		export interface IEnterAction {
			indentAction:IndentAction;
			appendText?:string;
			removeText?:number;
		}
		export interface IOnEnterRegExpRules {
			beforeText: RegExp;
			afterText?: RegExp;
			action: IEnterAction;
		}
		export interface IOnEnterSupportOptions {
			brackets?: IBracketPair2[];
			indentationRules?: IIndentationRules;
			regExpRules?: IOnEnterRegExpRules[];
		}
		var OnEnterSupport: {
			register(modeId:string, opts:IOnEnterSupportOptions): Disposable;
		};
		// --- End IOnEnterSupport

		export interface IResourceEdit {
			resource: Uri;
			range?: Range;
			newText: string;
		}

		export interface IReference {
			resource: Uri;
			range: Range;
		}

		interface IMode {
			getId(): string;
		}

		export interface IWorker<T> {
			disposable: Disposable;
			load(): Thenable<T>;
		}

		function registerMonarchDefinition(modeId: string, language: Modes.ILanguage): Disposable;
		function loadInBackgroundWorker<T>(scriptSrc: string): IWorker<T>;

	}


}

declare module 'vscode-testing' {
	import vscode = require('vscode');
	export interface IRelaxedToken {
		startIndex: number;
		type: string;
		bracket?: vscode.Modes.Bracket;
	}
	export interface ITestItem {
		line: string;
		tokens: IRelaxedToken[];
	}
	export function testTokenization(name:string, language: vscode.Modes.ILanguage, tests:ITestItem[][]): void;
	export interface IOnEnterAsserter {
		nothing(oneLineAboveText:string, beforeText:string, afterText:string): void;
		indents(oneLineAboveText:string, beforeText:string, afterText:string): void;
		outdents(oneLineAboveText:string, beforeText:string, afterText:string): void;
		indentsOutdents(oneLineAboveText:string, beforeText:string, afterText:string): void;
	}
	export function testOnEnter(name:string, language: vscode.Modes.ILanguage, callback:(assertOnEnter:IOnEnterAsserter) => void): void;
}

/**
 * Thenable is a common denominator between ES6 promises, Q, jquery.Deferred, WinJS.Promise,
 * and others. This API makes no assumption about what promise libary is being used which
 * enables reusing existing code without migrating to a specific promise implementation. Still,
 * we recommand the use of native promises which are available in VS Code.
 */
interface Thenable<R> {
    /**
    * Attaches callbacks for the resolution and/or rejection of the Promise.
    * @param onfulfilled The callback to execute when the Promise is resolved.
    * @param onrejected The callback to execute when the Promise is rejected.
    * @returns A Promise for the completion of which ever callback is executed.
    */
    then<TResult>(onfulfilled?: (value: R) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>;
    then<TResult>(onfulfilled?: (value: R) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult>;
}

// ---- ES6 promise ------------------------------------------------------

/**
 * Represents the completion of an asynchronous operation
 */
interface Promise<T> extends Thenable<T> {
    /**
    * Attaches callbacks for the resolution and/or rejection of the Promise.
    * @param onfulfilled The callback to execute when the Promise is resolved.
    * @param onrejected The callback to execute when the Promise is rejected.
    * @returns A Promise for the completion of which ever callback is executed.
    */
    then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Promise<TResult>;
    then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Promise<TResult>;

    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch(onrejected?: (reason: any) => T | Thenable<T>): Promise<T>;

    // [Symbol.toStringTag]: string;
}

interface PromiseConstructor {
    // /**
    //   * A reference to the prototype.
    //   */
    // prototype: Promise<any>;

    /**
     * Creates a new Promise.
     * @param executor A callback used to initialize the promise. This callback is passed two arguments:
     * a resolve callback used resolve the promise with a value or the result of another promise,
     * and a reject callback used to reject the promise with a provided reason or error.
     */
    new <T>(executor: (resolve: (value?: T | Thenable<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;

    /**
     * Creates a Promise that is resolved with an array of results when all of the provided Promises
     * resolve, or rejected when any Promise is rejected.
     * @param values An array of Promises.
     * @returns A new Promise.
     */
    all<T>(values: Array<T | Thenable<T>>): Promise<T[]>;

    /**
     * Creates a Promise that is resolved or rejected when any of the provided Promises are resolved
     * or rejected.
     * @param values An array of Promises.
     * @returns A new Promise.
     */
    race<T>(values: Array<T | Thenable<T>>): Promise<T>;

    /**
     * Creates a new rejected promise for the provided reason.
     * @param reason The reason the promise was rejected.
     * @returns A new rejected Promise.
     */
    reject(reason: any): Promise<void>;

    /**
     * Creates a new rejected promise for the provided reason.
     * @param reason The reason the promise was rejected.
     * @returns A new rejected Promise.
     */
    reject<T>(reason: any): Promise<T>;

    /**
      * Creates a new resolved promise for the provided value.
      * @param value A promise.
      * @returns A promise whose internal state matches the provided promise.
      */
    resolve<T>(value: T | Thenable<T>): Promise<T>;

    /**
     * Creates a new resolved promise .
     * @returns A resolved promise.
     */
    resolve(): Promise<void>;

    // [Symbol.species]: Function;
}

declare var Promise: PromiseConstructor;
