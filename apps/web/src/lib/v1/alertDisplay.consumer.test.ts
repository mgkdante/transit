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
}

function analyzeAlertScript(source: string, fileName = 'fixture.svelte'): AlertScriptAnalysis {
	const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const typeKinds = new Map<string, AlertValueKind>();
	const objectShapes = new Map<string, ReadonlyMap<string, AlertValueKind>>();
	const values = new Set<string>();
	const collections = new Set<string>();
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

	function addName(name: ts.BindingName, kind: AlertValueKind): boolean {
		if (!ts.isIdentifier(name)) return false;
		const target = kind === 'value' ? values : collections;
		const size = target.size;
		target.add(name.text);
		return target.size !== size;
	}

	function seedBinding(name: ts.BindingName, type: ts.TypeNode | undefined): void {
		const kind = kindOfType(type);
		if (kind) addName(name, kind);
		if (!type || !ts.isTypeReferenceNode(type) || !ts.isObjectBindingPattern(name)) return;
		const shape = objectShapes.get(type.typeName.getText(ast));
		if (!shape) return;
		for (const element of name.elements) {
			const property = (element.propertyName ?? element.name).getText(ast);
			const propertyKind = shape.get(property);
			if (propertyKind) addName(element.name, propertyKind);
		}
	}

	function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
		visit(node);
		ts.forEachChild(node, (child) => walk(child, visit));
	}

	walk(ast, (node) => {
		if (ts.isVariableDeclaration(node) || ts.isParameter(node)) seedBinding(node.name, node.type);
	});

	function trackedIdentifier(node: ts.Expression): AlertValueKind | null {
		while (
			ts.isParenthesizedExpression(node) ||
			ts.isAsExpression(node) ||
			ts.isTypeAssertionExpression(node) ||
			ts.isNonNullExpression(node)
		) {
			node = node.expression;
		}
		if (!ts.isIdentifier(node)) return null;
		if (values.has(node.text)) return 'value';
		if (collections.has(node.text)) return 'collection';
		return null;
	}

	changed = true;
	while (changed) {
		changed = false;
		walk(ast, (node) => {
			if (ts.isVariableDeclaration(node) && node.initializer) {
				const kind = trackedIdentifier(node.initializer);
				if (kind) changed = addName(node.name, kind) || changed;
			}
			if (ts.isForOfStatement(node) && trackedIdentifier(node.expression) === 'collection') {
				const declaration = node.initializer;
				if (ts.isVariableDeclarationList(declaration)) {
					for (const item of declaration.declarations) {
						changed = addName(item.name, 'value') || changed;
					}
				}
			}
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				trackedIdentifier(node.expression.expression) === 'collection' &&
				ARRAY_CALLBACKS.has(node.expression.name.text)
			) {
				const callback = node.arguments[0];
				if (
					(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
					callback.parameters[0]
				) {
					changed = addName(callback.parameters[0].name, 'value') || changed;
				}
			}
		});
	}

	function report(node: ts.Node, field: string): void {
		const location = ast.getLineAndCharacterOfPosition(node.getStart(ast));
		violations.push(`${fileName}:${location.line + 1}:${location.character + 1} raw ${field}`);
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
			trackedIdentifier(node.expression) === 'value' &&
			RAW_COPY_FIELDS.has(node.name.text)
		) {
			report(node, node.name.text);
		}
		if (
			ts.isElementAccessExpression(node) &&
			trackedIdentifier(node.expression) === 'value' &&
			ts.isStringLiteral(node.argumentExpression) &&
			RAW_COPY_FIELDS.has(node.argumentExpression.text)
		) {
			report(node, node.argumentExpression.text);
		}
		if (
			(ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
			ts.isObjectBindingPattern(node.name) &&
			(kindOfType(node.type) === 'value' ||
				(node.initializer != null && trackedIdentifier(node.initializer) === 'value'))
		) {
			for (const element of node.name.elements) {
				const field = (element.propertyName ?? element.name).getText(ast);
				if (RAW_COPY_FIELDS.has(field)) report(element, field);
			}
		}
	});

	return { violations, values, collections };
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
	context?: TemplateNode;
	[key: string]: unknown;
}

interface TemplateScope {
	values: Set<string>;
	collections: Set<string>;
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
	};

	function copyScope(scope: TemplateScope): TemplateScope {
		return { values: new Set(scope.values), collections: new Set(scope.collections) };
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
		if (node?.type !== 'Identifier' || !node.name) return null;
		if (scope.values.has(node.name)) return 'value';
		if (scope.collections.has(node.name)) return 'collection';
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
				if (kind) {
					if (kind === 'value') reportRawBinding(assignment.left);
					addBinding(assignment.left, kind === 'value' ? scope.values : scope.collections);
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
				interface NavItem { description: string }
				const nav: NavItem = { description: 'Network status' };
				const row = { headline: 'Resolved service message' };
				void nav.description;
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
	});
});
