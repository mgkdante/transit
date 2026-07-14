import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'svelte/compiler';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const UI_ROOTS = ['src/lib/components', 'src/lib/features', 'src/routes'] as const;
const ALERT_TYPES = new Set(['Alert', 'AlertHistoryEntry', 'AlertArchiveEntry']);
const RAW_COPY_FIELDS = new Set([
	'header_key',
	'header_text',
	'header_text_en',
	'description',
	'description_en',
]);
const ARRAY_CALLBACKS = new Set([
	'every',
	'filter',
	'find',
	'findIndex',
	'flatMap',
	'forEach',
	'map',
	'some',
]);
const REDUCE_CALLBACKS = new Set(['reduce', 'reduceRight']);
const COLLECTION_PRESERVING_CALLS = new Set([
	'concat',
	'filter',
	'slice',
	'toReversed',
	'toSorted',
	'with',
]);
const COLLECTION_ELEMENT_CALLS = new Set(['at', 'find', 'pop', 'shift']);

type AlertValueKind = 'value' | 'collection';

function productionUiFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...productionUiFiles(path));
		else if (
			(path.endsWith('.svelte') || path.endsWith('.ts')) &&
			!path.endsWith('.d.ts') &&
			!path.includes('.test.') &&
			!path.includes('.spec.')
		) {
			files.push(path);
		}
	}
	return files;
}

interface AlertScriptAnalysis {
	violations: string[];
	values: Set<string>;
	collections: Set<string>;
	shapes: Map<string, ReadonlyMap<string, AlertValueKind>>;
}

function analyzeAlertScript(source: string, fileName = 'fixture.svelte'): AlertScriptAnalysis {
	const virtualFileName = '/alert-display-consumer.ts';
	const ast = ts.createSourceFile(
		virtualFileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const compilerOptions: ts.CompilerOptions = {
		module: ts.ModuleKind.ESNext,
		noLib: true,
		noResolve: true,
		target: ts.ScriptTarget.Latest,
	};
	const host: ts.CompilerHost = {
		fileExists: (requestedFileName) => requestedFileName === virtualFileName,
		getCanonicalFileName: (requestedFileName) => requestedFileName,
		getCurrentDirectory: () => '/',
		getDefaultLibFileName: () => '',
		getDirectories: () => [],
		getNewLine: () => '\n',
		getSourceFile: (requestedFileName) => (requestedFileName === virtualFileName ? ast : undefined),
		readFile: (requestedFileName) => (requestedFileName === virtualFileName ? source : undefined),
		useCaseSensitiveFileNames: () => true,
		writeFile: () => undefined,
	};
	const checker = ts.createProgram([virtualFileName], compilerOptions, host).getTypeChecker();
	const typeKinds = new Map<string, AlertValueKind>();
	const objectShapes = new Map<string, ReadonlyMap<string, AlertValueKind>>();
	const symbolKinds = new Map<ts.Symbol, AlertValueKind>();
	const symbolShapes = new Map<ts.Symbol, ReadonlyMap<string, AlertValueKind>>();
	const symbolReturnKinds = new Map<ts.Symbol, AlertValueKind>();
	const topLevelSymbols = new Map<string, ts.Symbol>();
	const valueBindingPatterns = new Set<ts.BindingName>();
	const violations: string[] = [];

	for (const statement of ast.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
			continue;
		if (!statement.moduleSpecifier.text.startsWith('$lib/v1')) continue;
		const imports = statement.importClause?.namedBindings;
		if (!imports || !ts.isNamedImports(imports)) continue;
		for (const specifier of imports.elements) {
			const imported = specifier.propertyName?.text ?? specifier.name.text;
			if (ALERT_TYPES.has(imported)) typeKinds.set(specifier.name.text, 'value');
			if (imported === 'toAlertViewModel') {
				violations.push(`${fileName}: UI imports forbidden toAlertViewModel`);
			}
		}
	}

	function kindOfType(node: ts.TypeNode | undefined): AlertValueKind | null {
		if (!node) return null;
		if (ts.isArrayTypeNode(node)) return kindOfType(node.elementType) ? 'collection' : null;
		if (ts.isTypeOperatorNode(node) || ts.isParenthesizedTypeNode(node))
			return kindOfType(node.type);
		if (ts.isUnionTypeNode(node)) {
			const kinds = node.types
				.map(kindOfType)
				.filter((kind): kind is AlertValueKind => kind != null);
			return kinds.includes('collection') ? 'collection' : kinds.includes('value') ? 'value' : null;
		}
		if (!ts.isTypeReferenceNode(node)) return null;
		const name = node.typeName.getText(ast);
		if (name === 'Array' || name === 'ReadonlyArray') {
			return node.typeArguments?.some((argument) => kindOfType(argument) != null)
				? 'collection'
				: null;
		}
		return typeKinds.get(name) ?? null;
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const statement of ast.statements) {
			if (!ts.isTypeAliasDeclaration(statement)) continue;
			const kind = kindOfType(statement.type);
			if (kind && !typeKinds.has(statement.name.text)) {
				typeKinds.set(statement.name.text, kind);
				changed = true;
			}
		}
	}

	for (const statement of ast.statements) {
		if (ts.isInterfaceDeclaration(statement)) {
			const shape = new Map<string, AlertValueKind>();
			for (const member of statement.members) {
				if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
				const kind = kindOfType(member.type);
				if (kind) shape.set(member.name.getText(ast).replace(/^['"]|['"]$/g, ''), kind);
			}
			objectShapes.set(statement.name.text, shape);
		} else if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
			const shape = new Map<string, AlertValueKind>();
			for (const member of statement.type.members) {
				if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
				const kind = kindOfType(member.type);
				if (kind) shape.set(member.name.getText(ast).replace(/^['"]|['"]$/g, ''), kind);
			}
			objectShapes.set(statement.name.text, shape);
		}
	}

	function symbolOfIdentifier(node: ts.Identifier): ts.Symbol | null {
		return checker.getSymbolAtLocation(node) ?? null;
	}

	function setSymbolKind(symbol: ts.Symbol | null, kind: AlertValueKind): boolean {
		if (!symbol || symbolKinds.has(symbol)) return false;
		symbolKinds.set(symbol, kind);
		return true;
	}

	function setSymbolReturnKind(symbol: ts.Symbol | null, kind: AlertValueKind): boolean {
		if (!symbol || symbolReturnKinds.has(symbol)) return false;
		symbolReturnKinds.set(symbol, kind);
		return true;
	}

	function forEachBindingIdentifier(
		name: ts.BindingName,
		visit: (identifier: ts.Identifier) => void,
	): void {
		if (ts.isIdentifier(name)) {
			visit(name);
			return;
		}
		for (const element of name.elements) {
			if (ts.isOmittedExpression(element)) continue;
			forEachBindingIdentifier(element.name, visit);
		}
	}

	function bindKind(name: ts.BindingName, kind: AlertValueKind): boolean {
		if (ts.isIdentifier(name)) return setSymbolKind(symbolOfIdentifier(name), kind);
		if (kind !== 'collection' || !ts.isArrayBindingPattern(name)) {
			if (kind === 'value') valueBindingPatterns.add(name);
			return false;
		}

		let added = false;
		for (const element of name.elements) {
			if (ts.isOmittedExpression(element)) continue;
			const elementKind = element.dotDotDotToken ? 'collection' : 'value';
			if (elementKind === 'value') valueBindingPatterns.add(element.name);
			added = bindKind(element.name, elementKind) || added;
		}
		return added;
	}

	function shapeOfType(type: ts.TypeNode | undefined): ReadonlyMap<string, AlertValueKind> | null {
		if (!type) return null;
		if (ts.isTypeOperatorNode(type) || ts.isParenthesizedTypeNode(type)) {
			return shapeOfType(type.type);
		}
		if (ts.isUnionTypeNode(type)) {
			return type.types.map(shapeOfType).find((shape) => shape != null) ?? null;
		}
		if (!ts.isTypeReferenceNode(type)) return null;
		return objectShapes.get(type.typeName.getText(ast)) ?? null;
	}

	function propertyName(node: ts.Node): string | null {
		if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
			return node.text;
		}
		return null;
	}

	function bindShape(name: ts.BindingName, shape: ReadonlyMap<string, AlertValueKind>): boolean {
		if (ts.isIdentifier(name)) {
			const symbol = symbolOfIdentifier(name);
			if (!symbol || symbolShapes.get(symbol) === shape) return false;
			symbolShapes.set(symbol, shape);
			return true;
		}
		if (!ts.isObjectBindingPattern(name)) return false;

		let added = false;
		for (const element of name.elements) {
			const field = propertyName(element.propertyName ?? element.name);
			const kind = field ? shape.get(field) : null;
			if (kind) added = bindKind(element.name, kind) || added;
		}
		return added;
	}

	function seedBinding(name: ts.BindingName, type: ts.TypeNode | undefined): void {
		const kind = kindOfType(type);
		if (kind) bindKind(name, kind);
		const shape = shapeOfType(type);
		if (shape) bindShape(name, shape);
	}

	function returnKindOfType(type: ts.TypeNode | undefined): AlertValueKind | null {
		if (!type) return null;
		if (ts.isParenthesizedTypeNode(type)) return returnKindOfType(type.type);
		if (ts.isUnionTypeNode(type)) {
			return mergeKinds(...type.types.map(returnKindOfType));
		}
		return ts.isFunctionTypeNode(type) ? kindOfType(type.type) : null;
	}

	function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
		visit(node);
		ts.forEachChild(node, (child) => walk(child, visit));
	}

	for (const statement of ast.statements) {
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				forEachBindingIdentifier(declaration.name, (identifier) => {
					const symbol = symbolOfIdentifier(identifier);
					if (symbol) topLevelSymbols.set(identifier.text, symbol);
				});
			}
		} else if (ts.isFunctionDeclaration(statement) && statement.name) {
			const symbol = symbolOfIdentifier(statement.name);
			if (symbol) topLevelSymbols.set(statement.name.text, symbol);
		}
	}

	walk(ast, (node) => {
		if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
			seedBinding(node.name, node.type);
		}
		if (ts.isFunctionDeclaration(node) && node.name) {
			const returnKind = kindOfType(node.type);
			if (returnKind) setSymbolReturnKind(symbolOfIdentifier(node.name), returnKind);
		}
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
			const initializer = node.initializer;
			const returnKind =
				returnKindOfType(node.type) ??
				(initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
					? kindOfType(initializer.type)
					: null);
			if (returnKind) setSymbolReturnKind(symbolOfIdentifier(node.name), returnKind);
		}
	});

	function unwrapExpression(node: ts.Expression): ts.Expression {
		while (
			ts.isParenthesizedExpression(node) ||
			ts.isAsExpression(node) ||
			ts.isTypeAssertionExpression(node) ||
			ts.isNonNullExpression(node) ||
			ts.isSatisfiesExpression(node)
		) {
			node = node.expression;
		}
		return node;
	}

	function mergeKinds(...kinds: Array<AlertValueKind | null>): AlertValueKind | null {
		const known = kinds.filter((kind): kind is AlertValueKind => kind != null);
		if (known.length === 0) return null;
		return known.every((kind) => kind === known[0]) ? known[0] : null;
	}

	function isRuneCall(node: ts.CallExpression): boolean {
		return (
			(ts.isIdentifier(node.expression) &&
				(node.expression.text === '$derived' ||
					node.expression.text === '$props' ||
					node.expression.text === '$state')) ||
			(ts.isPropertyAccessExpression(node.expression) &&
				ts.isIdentifier(node.expression.expression) &&
				node.expression.expression.text === '$derived' &&
				node.expression.name.text === 'by')
		);
	}

	function runeBody(node: ts.CallExpression): ts.Expression | null {
		if (
			ts.isIdentifier(node.expression) &&
			(node.expression.text === '$derived' || node.expression.text === '$state')
		) {
			return node.arguments[0] ?? null;
		}
		if (
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === '$derived' &&
			node.expression.name.text === 'by'
		) {
			const callback = node.arguments[0];
			if (
				callback != null &&
				(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
				!ts.isBlock(callback.body)
			) {
				return callback.body;
			}
		}
		return null;
	}

	function shapeOfExpression(
		node: ts.Expression | undefined,
	): ReadonlyMap<string, AlertValueKind> | null {
		if (!node) return null;
		if (
			ts.isAsExpression(node) ||
			ts.isTypeAssertionExpression(node) ||
			ts.isSatisfiesExpression(node)
		) {
			const assertedShape = shapeOfType(node.type);
			if (assertedShape) return assertedShape;
		}
		node = unwrapExpression(node);
		if (ts.isIdentifier(node)) {
			const symbol = symbolOfIdentifier(node);
			return symbol ? (symbolShapes.get(symbol) ?? null) : null;
		}
		if (ts.isCallExpression(node)) {
			const body = runeBody(node);
			if (body) return shapeOfExpression(body);
			if (isRuneCall(node)) {
				return node.typeArguments?.map(shapeOfType).find((shape) => shape != null) ?? null;
			}
		}
		if (ts.isConditionalExpression(node)) {
			return shapeOfExpression(node.whenTrue) ?? shapeOfExpression(node.whenFalse);
		}
		if (
			ts.isBinaryExpression(node) &&
			(node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
				node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
				node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
		) {
			return shapeOfExpression(node.left) ?? shapeOfExpression(node.right);
		}
		return null;
	}

	function callbackReturnKind(callback: ts.Expression | undefined): AlertValueKind | null {
		if (!callback) return null;
		callback = unwrapExpression(callback);
		if (ts.isIdentifier(callback)) {
			const symbol = symbolOfIdentifier(callback);
			return symbol ? (symbolReturnKinds.get(symbol) ?? null) : null;
		}
		if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null;
		const callbackFunction = callback;
		const annotatedKind = kindOfType(callbackFunction.type);
		if (annotatedKind) return annotatedKind;
		if (!ts.isBlock(callbackFunction.body)) return expressionKind(callbackFunction.body);

		const returnKinds: Array<AlertValueKind | null> = [];
		function collectReturns(node: ts.Node): void {
			if (node !== callbackFunction.body && ts.isFunctionLike(node)) return;
			if (ts.isReturnStatement(node)) {
				returnKinds.push(expressionKind(node.expression));
				return;
			}
			ts.forEachChild(node, collectReturns);
		}
		collectReturns(callbackFunction.body);
		return mergeKinds(...returnKinds);
	}

	function expressionKind(node: ts.Expression | undefined): AlertValueKind | null {
		if (!node) return null;
		if (
			ts.isAsExpression(node) ||
			ts.isTypeAssertionExpression(node) ||
			ts.isSatisfiesExpression(node)
		) {
			const assertedKind = kindOfType(node.type);
			if (assertedKind) return assertedKind;
		}
		node = unwrapExpression(node);
		if (ts.isIdentifier(node)) {
			const symbol = symbolOfIdentifier(node);
			return symbol ? (symbolKinds.get(symbol) ?? null) : null;
		}
		if (ts.isPropertyAccessExpression(node)) {
			return shapeOfExpression(node.expression)?.get(node.name.text) ?? null;
		}
		if (ts.isElementAccessExpression(node)) {
			if (expressionKind(node.expression) === 'collection') return 'value';
			const field = node.argumentExpression ? propertyName(node.argumentExpression) : null;
			return field ? (shapeOfExpression(node.expression)?.get(field) ?? null) : null;
		}
		if (ts.isCallExpression(node)) {
			const body = runeBody(node);
			if (body) return expressionKind(body);
			if (isRuneCall(node)) {
				const typeKind = node.typeArguments
					?.map(kindOfType)
					.find((kind): kind is AlertValueKind => kind != null);
				if (typeKind) return typeKind;
			}
			if (ts.isIdentifier(node.expression)) {
				const symbol = symbolOfIdentifier(node.expression);
				const returnKind = symbol ? symbolReturnKinds.get(symbol) : null;
				if (returnKind) return returnKind;
			}
			if (ts.isPropertyAccessExpression(node.expression)) {
				const collection = expressionKind(node.expression.expression);
				const method = node.expression.name.text;
				if (collection === 'collection') {
					if (COLLECTION_PRESERVING_CALLS.has(method)) return 'collection';
					if (COLLECTION_ELEMENT_CALLS.has(method)) return 'value';
					const returnKind = callbackReturnKind(node.arguments[0]);
					if (method === 'map' && returnKind === 'value') return 'collection';
					if (method === 'flatMap' && returnKind) return 'collection';
				}
			}
		}
		if (ts.isArrayLiteralExpression(node)) {
			for (const element of node.elements) {
				if (
					(ts.isSpreadElement(element) && expressionKind(element.expression) === 'collection') ||
					(!ts.isSpreadElement(element) && expressionKind(element) === 'value')
				) {
					return 'collection';
				}
			}
		}
		if (ts.isConditionalExpression(node)) {
			return mergeKinds(expressionKind(node.whenTrue), expressionKind(node.whenFalse));
		}
		if (
			ts.isBinaryExpression(node) &&
			(node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
				node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
				node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
		) {
			return mergeKinds(expressionKind(node.left), expressionKind(node.right));
		}
		return null;
	}

	changed = true;
	while (changed) {
		changed = false;
		walk(ast, (node) => {
			if (ts.isVariableDeclaration(node) && node.initializer) {
				const kind = expressionKind(node.initializer);
				if (kind) changed = bindKind(node.name, kind) || changed;
				const shape = shapeOfExpression(node.initializer);
				if (shape) changed = bindShape(node.name, shape) || changed;
				if (ts.isIdentifier(node.name)) {
					const initializer = unwrapExpression(node.initializer);
					if (ts.isIdentifier(initializer)) {
						const sourceSymbol = symbolOfIdentifier(initializer);
						const returnKind = sourceSymbol ? symbolReturnKinds.get(sourceSymbol) : null;
						if (returnKind) {
							changed = setSymbolReturnKind(symbolOfIdentifier(node.name), returnKind) || changed;
						}
					}
				}
			}
			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				ts.isIdentifier(node.left)
			) {
				const kind = expressionKind(node.right);
				if (kind) changed = bindKind(node.left, kind) || changed;
				const shape = shapeOfExpression(node.right);
				if (shape) changed = bindShape(node.left, shape) || changed;
			}
			if (ts.isForOfStatement(node) && expressionKind(node.expression) === 'collection') {
				const declaration = node.initializer;
				if (ts.isVariableDeclarationList(declaration)) {
					for (const item of declaration.declarations) {
						valueBindingPatterns.add(item.name);
						changed = bindKind(item.name, 'value') || changed;
					}
				}
			}
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				expressionKind(node.expression.expression) === 'collection'
			) {
				const method = node.expression.name.text;
				const itemIndex = ARRAY_CALLBACKS.has(method) ? 0 : REDUCE_CALLBACKS.has(method) ? 1 : null;
				if (itemIndex == null) return;
				const callback = node.arguments[0];
				if (
					(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
					callback.parameters[itemIndex]
				) {
					const parameter = callback.parameters[itemIndex];
					valueBindingPatterns.add(parameter.name);
					changed = bindKind(parameter.name, 'value') || changed;
				}
			}
		});
	}

	function report(node: ts.Node, field: string): void {
		const location = ast.getLineAndCharacterOfPosition(node.getStart(ast));
		violations.push(`${fileName}:${location.line + 1}:${location.character + 1} raw ${field}`);
	}

	function bindingContainsAlertValue(name: ts.BindingName): boolean {
		if (valueBindingPatterns.has(name)) return true;
		if (ts.isIdentifier(name)) return false;
		return name.elements.some(
			(element) => !ts.isOmittedExpression(element) && bindingContainsAlertValue(element.name),
		);
	}

	function reportRawBinding(name: ts.BindingName): void {
		if (ts.isIdentifier(name)) return;
		for (const element of name.elements) {
			if (ts.isOmittedExpression(element)) continue;
			if (ts.isObjectBindingPattern(name)) {
				const field = propertyName(element.propertyName ?? element.name);
				if (field && RAW_COPY_FIELDS.has(field)) report(element, field);
			}
			reportRawBinding(element.name);
		}
	}

	walk(ast, (node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'toAlertViewModel'
		) {
			report(node, 'toAlertViewModel');
		}
		if (
			ts.isPropertyAccessExpression(node) &&
			expressionKind(node.expression) === 'value' &&
			RAW_COPY_FIELDS.has(node.name.text)
		) {
			report(node, node.name.text);
		}
		if (
			ts.isElementAccessExpression(node) &&
			expressionKind(node.expression) === 'value' &&
			ts.isStringLiteral(node.argumentExpression) &&
			RAW_COPY_FIELDS.has(node.argumentExpression.text)
		) {
			report(node, node.argumentExpression.text);
		}
		if (
			(ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
			bindingContainsAlertValue(node.name)
		) {
			reportRawBinding(node.name);
		}
	});

	const values = new Set<string>();
	const collections = new Set<string>();
	const shapes = new Map<string, ReadonlyMap<string, AlertValueKind>>();
	for (const [name, symbol] of topLevelSymbols) {
		const kind = symbolKinds.get(symbol);
		if (kind === 'value') values.add(name);
		if (kind === 'collection') collections.add(name);
		const shape = symbolShapes.get(symbol);
		if (shape) shapes.set(name, shape);
	}

	return { collections, shapes, values, violations };
}

function alertCopyViolations(source: string, fileName = 'fixture.svelte'): string[] {
	return analyzeAlertScript(source, fileName).violations;
}

interface TemplateNode {
	type?: string;
	start?: number;
	name?: string;
	computed?: boolean;
	object?: TemplateNode;
	property?: TemplateNode;
	expression?: TemplateNode;
	left?: TemplateNode;
	right?: TemplateNode;
	consequent?: TemplateNode;
	alternate?: TemplateNode;
	operator?: string;
	context?: TemplateNode;
	[key: string]: unknown;
}

interface TemplateScope {
	values: Set<string>;
	collections: Set<string>;
	shapes: Map<string, ReadonlyMap<string, AlertValueKind>>;
}

function svelteAlertCopyViolations(source: string, fileName = 'fixture.svelte'): string[] {
	const parsed = parse(source, { filename: fileName });
	const instance = parsed.instance;
	const script = instance ? source.slice(instance.content.start, instance.content.end) : '';
	const analysis = analyzeAlertScript(script, fileName);
	const violations = [...analysis.violations];
	const rootScope: TemplateScope = {
		values: new Set(analysis.values),
		collections: new Set(analysis.collections),
		shapes: new Map(analysis.shapes),
	};

	function copyScope(scope: TemplateScope): TemplateScope {
		return {
			values: new Set(scope.values),
			collections: new Set(scope.collections),
			shapes: new Map(scope.shapes),
		};
	}

	function shapeOfExpression(
		node: TemplateNode | undefined,
		scope: TemplateScope,
	): ReadonlyMap<string, AlertValueKind> | null {
		while (
			node &&
			(node.type === 'ChainExpression' ||
				node.type === 'TSAsExpression' ||
				node.type === 'TSNonNullExpression')
		) {
			node = node.expression;
		}
		if (node?.type === 'Identifier' && node.name) {
			return scope.shapes.get(node.name) ?? null;
		}
		if (node?.type === 'ConditionalExpression') {
			return shapeOfExpression(node.consequent, scope) ?? shapeOfExpression(node.alternate, scope);
		}
		if (
			node?.type === 'LogicalExpression' &&
			(node.operator === '??' || node.operator === '||' || node.operator === '&&')
		) {
			return shapeOfExpression(node.left, scope) ?? shapeOfExpression(node.right, scope);
		}
		return null;
	}

	function expressionKind(
		node: TemplateNode | undefined,
		scope: TemplateScope,
	): AlertValueKind | null {
		while (
			node &&
			(node.type === 'ChainExpression' ||
				node.type === 'TSAsExpression' ||
				node.type === 'TSNonNullExpression')
		) {
			node = node.expression;
		}
		if (node?.type === 'Identifier' && node.name) {
			if (scope.values.has(node.name)) return 'value';
			if (scope.collections.has(node.name)) return 'collection';
		}
		if (node?.type === 'MemberExpression') {
			const field = fieldName(node);
			return field ? (shapeOfExpression(node.object, scope)?.get(field) ?? null) : null;
		}
		if (node?.type === 'ConditionalExpression') {
			const left = expressionKind(node.consequent, scope);
			const right = expressionKind(node.alternate, scope);
			return left === right ? left : (left ?? right);
		}
		if (
			node?.type === 'LogicalExpression' &&
			(node.operator === '??' || node.operator === '||' || node.operator === '&&')
		) {
			const left = expressionKind(node.left, scope);
			const right = expressionKind(node.right, scope);
			return left === right ? left : (left ?? right);
		}
		return null;
	}

	function fieldName(node: TemplateNode): string | null {
		if (!node.computed && node.property?.type === 'Identifier') return node.property.name ?? null;
		if (
			node.computed &&
			(node.property?.type === 'Literal' || node.property?.type === 'StringLiteral')
		) {
			const value = node.property.value;
			return typeof value === 'string' ? value : null;
		}
		return null;
	}

	function report(node: TemplateNode, field: string): void {
		const before = source.slice(0, node.start ?? 0);
		const line = before.split('\n').length;
		const column = before.length - before.lastIndexOf('\n') - 1 + 1;
		violations.push(`${fileName}:${line}:${column} raw ${field}`);
	}

	function scanExpression(node: TemplateNode | undefined, scope: TemplateScope): void {
		if (!node || typeof node !== 'object') return;
		if (node.type === 'MemberExpression' && expressionKind(node.object, scope) === 'value') {
			const field = fieldName(node);
			if (field && RAW_COPY_FIELDS.has(field)) report(node, field);
		}
		if (
			node.type === 'CallExpression' &&
			node.callee &&
			typeof node.callee === 'object' &&
			(node.callee as TemplateNode).type === 'Identifier' &&
			(node.callee as TemplateNode).name === 'toAlertViewModel'
		) {
			report(node, 'toAlertViewModel');
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === 'loc' || key === 'start' || key === 'end') continue;
			if (Array.isArray(value)) {
				for (const child of value) scanExpression(child as TemplateNode, scope);
			} else if (value && typeof value === 'object') {
				scanExpression(value as TemplateNode, scope);
			}
		}
	}

	function addBinding(node: TemplateNode | undefined, target: Set<string>): void {
		if (!node) return;
		if (node.type === 'Identifier' && node.name) {
			target.add(node.name);
			return;
		}
		if (node.type === 'Property') {
			addBinding(node.value as TemplateNode, target);
			return;
		}
		if (node.type === 'RestElement') {
			addBinding(node.argument as TemplateNode, target);
			return;
		}
		if (node.type === 'AssignmentPattern') {
			addBinding(node.left, target);
			return;
		}
		const entries =
			node.type === 'ObjectPattern'
				? node.properties
				: node.type === 'ArrayPattern'
					? node.elements
					: [];
		if (Array.isArray(entries)) {
			for (const child of entries) {
				if (child && typeof child === 'object') addBinding(child as TemplateNode, target);
			}
		}
	}

	function clearBinding(node: TemplateNode | undefined, scope: TemplateScope): void {
		if (!node) return;
		if (node.type === 'Identifier' && node.name) {
			scope.values.delete(node.name);
			scope.collections.delete(node.name);
			scope.shapes.delete(node.name);
			return;
		}
		if (node.type === 'Property') {
			clearBinding(node.value as TemplateNode, scope);
			return;
		}
		if (node.type === 'RestElement') {
			clearBinding(node.argument as TemplateNode, scope);
			return;
		}
		if (node.type === 'AssignmentPattern') {
			clearBinding(node.left, scope);
			return;
		}
		const entries =
			node.type === 'ObjectPattern'
				? node.properties
				: node.type === 'ArrayPattern'
					? node.elements
					: [];
		if (Array.isArray(entries)) {
			for (const child of entries) {
				if (child && typeof child === 'object') clearBinding(child as TemplateNode, scope);
			}
		}
	}

	function reportRawBinding(node: TemplateNode | undefined): void {
		if (!node) return;
		if (node.type === 'Property') {
			const key = node.key as TemplateNode | undefined;
			const field =
				key?.type === 'Identifier'
					? key.name
					: key?.type === 'Literal' && typeof key.value === 'string'
						? key.value
						: null;
			if (field && RAW_COPY_FIELDS.has(field)) report(node, field);
			reportRawBinding(node.value as TemplateNode);
			return;
		}
		const entries =
			node.type === 'ObjectPattern'
				? node.properties
				: node.type === 'ArrayPattern'
					? node.elements
					: [];
		if (Array.isArray(entries)) {
			for (const child of entries) {
				if (child && typeof child === 'object') reportRawBinding(child as TemplateNode);
			}
		}
	}

	function scanTemplate(node: TemplateNode | undefined, scope: TemplateScope): void {
		if (!node || typeof node !== 'object') return;
		if (node.type === 'EachBlock') {
			scanExpression(node.expression, scope);
			const childScope = copyScope(scope);
			clearBinding(node.context, childScope);
			if (expressionKind(node.expression, scope) === 'collection') {
				reportRawBinding(node.context);
				addBinding(node.context, childScope.values);
			}
			const children = Array.isArray(node.children) ? node.children : [];
			for (const child of children) scanTemplate(child as TemplateNode, childScope);
			if (node.else && typeof node.else === 'object') {
				scanTemplate(node.else as TemplateNode, copyScope(scope));
			}
			return;
		}
		if (node.type === 'ConstTag') {
			const assignment = node.expression;
			if (assignment?.type === 'AssignmentExpression') {
				scanExpression(assignment.right, scope);
				const kind = expressionKind(assignment.right, scope);
				const shape = shapeOfExpression(assignment.right, scope);
				clearBinding(assignment.left, scope);
				if (kind) {
					if (kind === 'value') reportRawBinding(assignment.left);
					addBinding(assignment.left, kind === 'value' ? scope.values : scope.collections);
				}
				if (shape && assignment.left?.type === 'Identifier' && assignment.left.name) {
					scope.shapes.set(assignment.left.name, shape);
				}
			}
			return;
		}
		if (node.expression && typeof node.expression === 'object') {
			scanExpression(node.expression, scope);
		}
		for (const [key, value] of Object.entries(node)) {
			if (
				key === 'expression' ||
				key === 'context' ||
				key === 'loc' ||
				key === 'start' ||
				key === 'end'
			) {
				continue;
			}
			if (Array.isArray(value)) {
				for (const child of value) scanTemplate(child as TemplateNode, scope);
			} else if (value && typeof value === 'object') {
				scanTemplate(value as TemplateNode, scope);
			}
		}
	}

	scanTemplate(parsed.html as TemplateNode, rootScope);
	return violations;
}

function uiFileViolations(path: string): string[] {
	const source = readFileSync(path, 'utf8');
	const fileName = relative(process.cwd(), path);
	return path.endsWith('.svelte')
		? svelteAlertCopyViolations(source, fileName)
		: alertCopyViolations(source, fileName);
}

describe('alert display UI boundary', () => {
	it('traces direct reads, destructuring, and aliases from alert contract values', () => {
		const violations = alertCopyViolations(`
			import type { AlertHistoryEntry } from '$lib/v1';
			function headline(entry: AlertHistoryEntry) {
				const alias = entry;
				const { description_en: body } = alias;
				return entry.description ?? alias.header_text ?? body;
			}
		`);

		expect(violations.join('\n')).toContain('raw description_en');
		expect(violations.join('\n')).toContain('raw description');
		expect(violations.join('\n')).toContain('raw header_text');
	});

	it('traces rune, conditional, coalesced, typed-member, callback, and destructured aliases', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			interface Props { alert: Alert; alerts: readonly Alert[] }
			const props: Props = $props();
			const member = props.alert;
			const collection = props.alerts;
			const runeAlias = $derived(member);
			const stateAlias = $state(props.alert);
			const conditionalAlias = true ? runeAlias : null;
			const coalescedAlias = undefined ?? stateAlias;
			const { alert: destructured, alerts: destructuredCollection } = props;
			const { description_en: stateDescription } = stateAlias;
			void runeAlias.header_text_en;
			void stateDescription;
			void conditionalAlias.header_text;
			void coalescedAlias.description;
			void destructured.header_key;
			collection.forEach((item) => void item.description);
			destructuredCollection.map((item) => item.header_text);
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1]).sort()).toEqual([
			'description',
			'description',
			'description_en',
			'header_key',
			'header_text',
			'header_text',
			'header_text_en',
		]);
	});

	it('traces Alert collections through collection-preserving array calls', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			const alerts: Alert[] = [];
			alerts.slice().map((alert) => alert.description);
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['description']);
	});

	it('traces Alert collections returned by block-bodied map callbacks', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			const alerts: Alert[] = [];
			alerts
				.map((alert) => {
					return alert;
				})
				.forEach((copy) => void copy.description);
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['description']);
	});

	it('traces Alert collections returned by flatMap callbacks', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			const alerts: Alert[] = [];
			alerts
				.flatMap((alert) => [alert])
				.forEach((copy) => void copy.header_text);
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['header_text']);
	});

	it('traces Alert collections returned by explicitly typed inline callbacks', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			import { externalAlert } from './external';
			const alerts: Alert[] = [];
			alerts
				.map((): Alert => externalAlert())
				.forEach((item) => void item.description);
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['description']);
	});

	it('traces Alert collections returned by named typed callbacks', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			const alerts: Alert[] = [];
			const identity = (alert: Alert): Alert => alert;
			alerts.map(identity).forEach((item) => void item.header_text);
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['header_text']);
	});

	it('traces Alert collections through array spreads', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			const alerts: Alert[] = [];
			[...alerts].forEach((alert) => void alert.header_text);
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['header_text']);
	});

	it('traces aliases returned by explicitly typed functions', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			const getArrowAlert = (): Alert => ({}) as Alert;
			declare function getDeclaredAlert(): Alert;
			const arrowAlert = getArrowAlert();
			const declaredAlert = getDeclaredAlert();
			void arrowAlert.description_en;
			void declaredAlert.header_text_en;
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual([
			'description_en',
			'header_text_en',
		]);
	});

	it('keeps callback bindings lexical when names are reused for unrelated values', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			const alerts: Alert[] = [];
			alerts.forEach((item) => void item.header_text);
			const navigation = [{ description: 'Network status' }];
			navigation.forEach((item) => void item.description);
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['header_text']);
	});

	it('traces array-destructured Alert collection elements', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			const alerts: Alert[] = [];
			const [alert] = alerts;
			void alert.description;
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['description']);
	});

	it('traces Alert collection elements through reduce callbacks', () => {
		const violations = alertCopyViolations(`
			import type { Alert } from '$lib/v1';
			const alerts: Alert[] = [];
			alerts.reduce((_, alert) => alert.description, '');
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['description']);
	});

	it('traces typed alert values through Svelte markup, each blocks, and local aliases', () => {
		const violations = svelteAlertCopyViolations(`
			<script lang="ts">
				import type { Alert } from '$lib/v1';
				interface Props { alert: Alert; alerts: readonly Alert[] }
				let { alert, alerts }: Props = $props();
			</script>
			<p>{alert.description}</p>
			{@const { header_text_en: localizedHeader } = alert}
			<span>{localizedHeader}</span>
			{#each alerts as item}
				{@const alias = item}
				{@const nestedAlias = alias}
				<span>{nestedAlias.header_text}</span>
			{/each}
			{#each alerts as { description_en: localizedBody }}
				<span>{localizedBody}</span>
			{/each}
		`);

		expect(violations.join('\n')).toContain('raw description');
		expect(violations.join('\n')).toContain('raw header_text');
		expect(violations.join('\n')).toContain('raw header_text_en');
		expect(violations.join('\n')).toContain('raw description_en');
	});

	it('carries rune-wrapped typed prop members and conditional aliases into Svelte markup', () => {
		const violations = svelteAlertCopyViolations(`
			<script lang="ts">
				import type { Alert } from '$lib/v1';
				interface Props { alert: Alert; alerts: readonly Alert[] }
				const props: Props = $props();
				const member = $derived(props.alert);
				const collection = $state(props.alerts);
			</script>
			{@const chosen = true ? member : null}
			<p>{chosen.description_en}</p>
			{#each collection as { header_text: headline }}
				<strong>{headline}</strong>
			{/each}
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual([
			'description_en',
			'header_text',
		]);
	});

	it('traces direct typed prop values through Svelte const aliases', () => {
		const violations = svelteAlertCopyViolations(`
			<script lang="ts">
				import type { Alert } from '$lib/v1';
				interface Props { alert: Alert }
				const props: Props = $props();
			</script>
			{@const alert = props.alert}
			<p>{alert.description}</p>
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['description']);
	});

	it('traces direct typed prop collections through Svelte each blocks', () => {
		const violations = svelteAlertCopyViolations(`
			<script lang="ts">
				import type { Alert } from '$lib/v1';
				interface Props { alerts: readonly Alert[] }
				const props: Props = $props();
			</script>
			{#each props.alerts as alert}
				<p>{alert.header_text}</p>
			{/each}
		`);

		expect(violations.map((violation) => violation.split(' raw ')[1])).toEqual(['header_text']);
	});

	it('allows unrelated descriptions and resolved headlines in Svelte markup', () => {
		expect(
			svelteAlertCopyViolations(`
				<script lang="ts">
					const nav = { description: 'Network status' };
					const row = { headline: 'Resolved service message' };
				</script>
				<p>{nav.description}</p>
				<strong>{row.headline}</strong>
			`),
		).toEqual([]);
	});

	it('allows unrelated descriptions and resolved row headlines', () => {
		expect(
			alertCopyViolations(`
				import type { Alert } from '$lib/v1';
				interface NavItem { description: string }
				declare function unrelatedMetadata<T>(): NavItem;
				const nav: NavItem = { description: 'Network status' };
				const genericNav = unrelatedMetadata<Alert>();
				const row = { headline: 'Resolved service message' };
				void nav.description;
				void genericNav.description;
				void row.headline;
			`),
		).toEqual([]);
	});

	it('forbids the dormant alert view-model in UI code', () => {
		const violations = alertCopyViolations(`
			import { toAlertViewModel } from '$lib/v1/sanitize';
			toAlertViewModel(source, 'en');
		`);

		expect(violations.join('\n')).toContain('toAlertViewModel');
	});

	it('keeps every production UI alert consumer behind alertDisplayText', () => {
		const violations = UI_ROOTS.flatMap((root) => productionUiFiles(root)).flatMap(
			uiFileViolations,
		);

		expect(violations).toEqual([]);
	}, 15_000);
});
