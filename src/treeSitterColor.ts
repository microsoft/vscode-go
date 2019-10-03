import * as Parser from 'web-tree-sitter';

export interface Range {
	start: Parser.Point;
	end: Parser.Point;
}

export function colorGo(root: Parser.Tree, visibleRanges: {start: number, end: number}[]): {[scope: string]: Range[]} {
	const functions: Range[] = [];
	const types: Range[] = [];
	const variables: Range[] = [];
	const underlines: Range[] = [];
	// Guess package names based on paths
	const packages: {[id: string]: boolean} = {};
	function scanImport(x: Parser.SyntaxNode) {
		if (x.type === 'import_spec') {
			let str = x.firstChild!.text;
			if (str.startsWith('"')) {
				str = str.substring(1, str.length - 1);
			}
			const parts = str.split('/');
			const last = parts[parts.length - 1];
			packages[last] = true;
		}
		for (const child of x.children) {
			scanImport(child);
		}
	}
	// Keep track of local vars that shadow packages
	const allScopes: Scope[] = [];
	class Scope {
		private locals = new Map<string, {modified: boolean, references: Parser.SyntaxNode[]}>();
		private parent: Scope|null;

		constructor(parent: Scope|null) {
			this.parent = parent;
			allScopes.push(this);
		}

		declareLocal(id: string) {
			if (this.isRoot()) return;
			if (this.locals.has(id)) {
				this.locals.get(id)!.modified = true;
			} else {
				this.locals.set(id, {modified: false, references: []});
			}
		}

		modifyLocal(id: string) {
			if (this.isRoot()) return;
			if (this.locals.has(id)) this.locals.get(id)!.modified = true;
			else if (this.parent) this.parent.modifyLocal(id);
		}

		referenceLocal(x: Parser.SyntaxNode) {
			if (this.isRoot()) return;
			const id = x.text;
			if (this.locals.has(id)) this.locals.get(id)!.references.push(x);
			else if (this.parent) this.parent.referenceLocal(x);
		}

		isLocal(id: string): boolean {
			if (this.locals.has(id)) return true;
			if (this.parent) return this.parent.isLocal(id);
			return false;
		}

		isUnknown(id: string): boolean {
			if (packages[id]) return false;
			if (this.locals.has(id)) return false;
			if (this.parent) return this.parent.isUnknown(id);
			return true;
		}

		isModified(id: string): boolean {
			if (this.locals.has(id)) return this.locals.get(id)!.modified;
			if (this.parent) return this.parent.isModified(id);
			return false;
		}

		modifiedLocals(): Parser.SyntaxNode[] {
			const all = [];
			for (const {modified, references} of this.locals.values()) {
				if (modified) {
					all.push(...references);
				}
			}
			return all;
		}

		isPackage(id: string): boolean {
			return packages[id] && !this.isLocal(id);
		}

		isRoot(): boolean {
			return this.parent === null;
		}
	}
	const rootScope = new Scope(null);
	function scanSourceFile() {
		for (const top of root.rootNode.namedChildren) {
			scanTopLevelDeclaration(top);
		}
	}
	function scanTopLevelDeclaration(x: Parser.SyntaxNode) {
		switch (x.type) {
			case 'import_declaration':
				scanImport(x);
				break;
			case 'function_declaration':
			case 'method_declaration':
				if (!isVisible(x, visibleRanges)) return;
				scanFunctionDeclaration(x);
				break;
			case 'const_declaration':
			case 'var_declaration':
				if (!isVisible(x, visibleRanges)) return;
				scanVarDeclaration(x);
				break;
			case 'type_declaration':
				if (!isVisible(x, visibleRanges)) return;
				scanTypeDeclaration(x);
				break;
		}
	}
	function scanFunctionDeclaration(x: Parser.SyntaxNode) {
		const scope = new Scope(rootScope);
		for (const child of x.namedChildren) {
			switch (child.type) {
				case 'identifier':
					if (isVisible(child, visibleRanges)) {
						functions.push({start: child.startPosition, end: child.endPosition});
					}
					break;
				default:
					scanExpr(child, scope);
			}
		}
	}
	function scanVarDeclaration(x: Parser.SyntaxNode) {
		for (const varSpec of x.namedChildren) {
			for (const child of varSpec.namedChildren) {
				switch (child.type) {
					case 'identifier':
						if (isVisible(child, visibleRanges)) {
							variables.push({start: child.startPosition, end: child.endPosition});
						}
						break;
					default:
						scanExpr(child, rootScope);
				}
			}
		}
	}
	function scanTypeDeclaration(x: Parser.SyntaxNode) {
		for (const child of x.namedChildren) {
			scanExpr(child, rootScope);
		}
	}
	function scanExpr(x: Parser.SyntaxNode, scope: Scope) {
		switch (x.type) {
			case 'ERROR':
				return;
			case 'func_literal':
			case 'block':
			case 'expression_case_clause':
			case 'type_case_clause':
			case 'for_statement':
			case 'if_statement':
			case 'type_switch_statement':
				scope = new Scope(scope);
				break;
			case 'parameter_declaration':
			case 'variadic_parameter_declaration':
			case 'var_spec':
			case 'const_spec':
				for (const id of x.namedChildren) {
					if (id.type === 'identifier') {
						scope.declareLocal(id.text);
					}
				}
				break;
			case 'short_var_declaration':
			case 'range_clause':
				for (const id of x.firstChild!.namedChildren) {
					if (id.type === 'identifier') {
						scope.declareLocal(id.text);
					}
				}
				break;
			case 'type_switch_guard':
				if (x.firstChild!.type === 'expression_list') {
					for (const id of x.firstChild!.namedChildren) {
						scope.declareLocal(id.text);
					}
				}
				break;
			case 'inc_statement':
			case 'dec_statement':
				scope.modifyLocal(x.firstChild!.text);
				break;
			case 'assignment_statement':
				for (const id of x.firstChild!.namedChildren) {
					if (id.type === 'identifier') {
						scope.modifyLocal(id.text);
					}
				}
				break;
			case 'call_expression':
				scanCall(x.firstChild!, scope);
				scanExpr(x.lastChild!, scope);
				return;
			case 'identifier':
				scope.referenceLocal(x);
				if (isVisible(x, visibleRanges) && scope.isUnknown(x.text)) {
					variables.push({start: x.startPosition, end: x.endPosition});
				}
				return;
			case 'selector_expression':
				if (isVisible(x, visibleRanges) && scope.isPackage(x.firstChild!.text)) {
					variables.push({start: x.lastChild!.startPosition, end: x.lastChild!.endPosition});
				}
				scanExpr(x.firstChild!, scope);
				scanExpr(x.lastChild!, scope);
				return;
			case 'type_identifier':
				if (isVisible(x, visibleRanges)) {
					types.push({start: x.startPosition, end: x.endPosition});
				}
				return;
		}
		for (const child of x.namedChildren) {
			scanExpr(child, scope);
		}
	}
	function scanCall(x: Parser.SyntaxNode, scope: Scope) {
		switch (x.type) {
			case 'identifier':
				if (isVisible(x, visibleRanges) && scope.isUnknown(x.text)) {
					functions.push({start: x.startPosition, end: x.endPosition});
				}
				scope.referenceLocal(x);
				return;
			case 'selector_expression':
				if (isVisible(x, visibleRanges) && scope.isPackage(x.firstChild!.text)) {
					functions.push({start: x.lastChild!.startPosition, end: x.lastChild!.endPosition});
				}
				scanExpr(x.firstChild!, scope);
				scanExpr(x.lastChild!, scope);
				return;
			case 'unary_expression':
				scanCall(x.firstChild!, scope);
				return;
			default:
				scanExpr(x, scope);
		}
	}
	scanSourceFile();
	for (const scope of allScopes) {
		for (const local of scope.modifiedLocals()) {
			underlines.push({start: local.startPosition, end: local.endPosition});
		}
	}

	return {
		'entity.name.function': functions,
		'entity.name.type': types,
		'variable': variables,
		'markup.underline': underlines,
	};
}

function isVisible(x: Parser.SyntaxNode, visibleRanges: {start: number, end: number}[]) {
	for (const {start, end} of visibleRanges) {
		const overlap = x.startPosition.row <= end + 1 && start - 1 <= x.endPosition.row;
		if (overlap) return true;
	}
	return false;
}
