import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

interface AstNode {
	type: string;
	start?: number;
	end?: number;
	[key: string]: unknown;
}

interface Violation {
	readonly file: string;
	readonly line: number;
	readonly lifecycle: string;
	readonly reason: string;
}

function isAstNode(value: unknown): value is AstNode {
	return value != null && typeof value === 'object' && 'type' in value;
}

function visit(node: AstNode, consume: (node: AstNode) => void): void {
	consume(node);
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) if (isAstNode(child)) visit(child, consume);
		} else if (isAstNode(value)) {
			visit(value, consume);
		}
	}
}

function lifecycleName(callee: unknown): string | null {
	if (!isAstNode(callee)) return null;
	if (callee.type === 'Identifier') {
		const name = callee['name'];
		return name === 'onMount' || name === 'onDestroy' || name === '$effect' ? name : null;
	}
	if (callee.type !== 'MemberExpression') return null;
	const object = callee['object'];
	const property = callee['property'];
	return isAstNode(object) &&
		object.type === 'Identifier' &&
		object['name'] === '$effect' &&
		isAstNode(property) &&
		property.type === 'Identifier' &&
		property['name'] === 'pre'
		? '$effect.pre'
		: null;
}

function isBoundaryCall(node: unknown): boolean {
	if (!isAstNode(node) || node.type !== 'CallExpression') return false;
	const callee = node['callee'];
	return isAstNode(callee) && callee.type === 'Identifier' && callee['name'] === 'mapOwnerBoundary';
}

function importsCanonicalBoundary(instance: AstNode): boolean {
	const body = instance['body'];
	if (!Array.isArray(body)) return false;
	return body.some((node) => {
		if (!isAstNode(node) || node.type !== 'ImportDeclaration') return false;
		const source = node['source'];
		if (!isAstNode(source) || source['value'] !== '$lib/components/map/mapOwnerBoundary') {
			return false;
		}
		const specifiers = node['specifiers'];
		return (
			Array.isArray(specifiers) &&
			specifiers.some((specifier) => {
				if (!isAstNode(specifier) || specifier.type !== 'ImportSpecifier') return false;
				const imported = specifier['imported'];
				const local = specifier['local'];
				return (
					isAstNode(imported) &&
					imported['name'] === 'mapOwnerBoundary' &&
					isAstNode(local) &&
					local['name'] === 'mapOwnerBoundary'
				);
			})
		);
	});
}

function returnedCleanupExpressions(callback: AstNode): readonly AstNode[] {
	const body = callback['body'];
	if (!isAstNode(body)) return [];
	if (body.type !== 'BlockStatement') return [body];

	const returned: AstNode[] = [];
	const inspect = (node: AstNode): void => {
		if (
			node !== body &&
			(node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression')
		) {
			return;
		}
		if (node.type === 'ReturnStatement') {
			const argument = node['argument'];
			if (isAstNode(argument)) returned.push(argument);
			return;
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				for (const child of value) if (isAstNode(child)) inspect(child);
			} else if (isAstNode(value)) {
				inspect(value);
			}
		}
	};
	inspect(body);
	return returned;
}

function sourceLine(source: string, offset = 0): number {
	return source.slice(0, offset).split('\n').length;
}

function inspectOwnerSource(file: string, source: string): readonly Violation[] {
	const violations: Violation[] = [];
	const instance = parse(source, { modern: true }).instance?.content;
	if (instance) {
		const ast = instance as unknown as AstNode;
		const canonicalBoundary = importsCanonicalBoundary(ast);
		visit(ast, (node) => {
			if (node.type !== 'CallExpression') return;
			const lifecycle = lifecycleName(node['callee']);
			if (!lifecycle) return;
			const callback = Array.isArray(node['arguments']) ? node['arguments'][0] : undefined;
			if (!isAstNode(callback)) return;

			if (lifecycle === 'onDestroy') {
				if (!isBoundaryCall(callback) || !canonicalBoundary) {
					violations.push({
						file,
						line: sourceLine(source, callback.start),
						lifecycle,
						reason: canonicalBoundary
							? 'onDestroy callback is outside mapOwnerBoundary'
							: 'mapOwnerBoundary is not imported from the canonical shared module',
					});
				}
				return;
			}

			for (const returned of returnedCleanupExpressions(callback)) {
				if (isBoundaryCall(returned) && canonicalBoundary) continue;
				violations.push({
					file,
					line: sourceLine(source, returned.start),
					lifecycle,
					reason:
						isBoundaryCall(returned) && !canonicalBoundary
							? 'mapOwnerBoundary is not imported from the canonical shared module'
							: 'returned cleanup is outside mapOwnerBoundary',
				});
			}
		});
	}

	for (const match of source.matchAll(/<svelte:(?:window|document|body)\b/gu)) {
		violations.push({
			file,
			line: sourceLine(source, match.index),
			lifecycle: match[0],
			reason: 'compiler-owned global cleanup is outside mapOwnerBoundary',
		});
	}
	return violations;
}

function componentFiles(directory: string): readonly string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) return entry.name === '__fixtures__' ? [] : componentFiles(path);
		return entry.isFile() && entry.name.endsWith('.svelte') ? [path] : [];
	});
}

describe('map component owner boundary enforcement', () => {
	it('detects raw multi-step, implicit, and compiler-owned cleanup registrations', () => {
		const unsafe = `<script>
			onMount(() => { return () => { first(); second(); }; });
			$effect(() => subscribe());
		</script>
		<svelte:window onkeydown={handleKeydown} />`;
		const safe = `<script>
			import { mapOwnerBoundary } from '$lib/components/map/mapOwnerBoundary';
			onMount(() => mapOwnerBoundary('owner', [first, second]));
			$effect(() => { const release = subscribe(); return mapOwnerBoundary('owner', [release]); });
			</script>`;
		const counterfeit = `<script>
			function mapOwnerBoundary() { return () => {}; }
			onMount(() => mapOwnerBoundary('owner', [first, second]));
			</script>`;

		expect(inspectOwnerSource('unsafe.svelte', unsafe).map(({ lifecycle }) => lifecycle)).toEqual([
			'onMount',
			'$effect',
			'<svelte:window',
		]);
		expect(inspectOwnerSource('safe.svelte', safe)).toEqual([]);
		expect(inspectOwnerSource('counterfeit.svelte', counterfeit)).toEqual([
			expect.objectContaining({
				reason: 'mapOwnerBoundary is not imported from the canonical shared module',
			}),
		]);
	});

	it('keeps every production map-feature cleanup behind mapOwnerBoundary', () => {
		const featureMap = import.meta.dirname;
		const componentMap = resolve(featureMap, '../../components/map');
		const freshnessStamp = resolve(featureMap, '../../components/surface/FreshnessStamp.svelte');
		const root = resolve(featureMap, '../../../..');
		const files = [...componentFiles(featureMap), ...componentFiles(componentMap), freshnessStamp];
		const violations = files.flatMap((file) =>
			inspectOwnerSource(relative(root, file), readFileSync(file, 'utf8')),
		);

		expect(violations).toEqual([]);
	});
});
