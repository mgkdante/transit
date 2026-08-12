import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(process.cwd(), 'src');
const V1_ROOT = join(SRC_ROOT, 'lib/v1');
const ADAPTER_ROOT = join(V1_ROOT, 'adapter');
const COMPONENTS_ROOT = join(SRC_ROOT, 'lib/components');
const STORES_ROOT = join(SRC_ROOT, 'lib/stores');
const FEATURES_ROOT = join(SRC_ROOT, 'lib/features');
const REPOSITORIES_ROOT = join(V1_ROOT, 'repositories');
const V1_CONFIG_ROOT = join(V1_ROOT, 'config');
// The snapshot-URL capability, denied to repositories by name rather than by module path.
const URL_BUILDER_CAPABILITY = ['resolveUrl', 'entityUrl', 'v1BaseUrl', 'v1Provider'] as const;

interface SourceBlock {
	readonly text: string;
	readonly offset: number;
}

interface ModuleReference {
	readonly specifier: string;
	readonly offset: number;
}

function productionSources(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) return productionSources(path);
		if (!/\.(?:svelte|ts)$/u.test(entry.name) || /\.(?:test|spec)\./u.test(entry.name)) return [];
		return [path];
	});
}

function sourceBlocks(path: string, source: string): SourceBlock[] {
	if (!path.endsWith('.svelte')) return [{ text: source, offset: 0 }];
	return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)].map((match) => ({
		text: match[1],
		offset: (match.index ?? 0) + match[0].indexOf(match[1]),
	}));
}

function moduleReferences(block: SourceBlock): ModuleReference[] {
	const ast = ts.createSourceFile(
		'architecture-boundary.ts',
		block.text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const references: ModuleReference[] = [];
	const record = (node: ts.Node, literal: ts.StringLiteralLike): void => {
		references.push({ specifier: literal.text, offset: block.offset + node.getStart(ast) });
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
			record(node, node.moduleSpecifier);
		} else if (
			ts.isExportDeclaration(node) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			record(node, node.moduleSpecifier);
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length === 1 &&
			ts.isStringLiteralLike(node.arguments[0])
		) {
			record(node, node.arguments[0]);
		}
		ts.forEachChild(node, visit);
	};
	visit(ast);
	return references;
}

function resolveModule(importer: string, specifier: string): string | null {
	if (specifier.startsWith('$lib/'))
		return resolve(SRC_ROOT, 'lib', specifier.slice('$lib/'.length));
	if (specifier.startsWith('.')) return resolve(dirname(importer), specifier);
	return null;
}

function isInside(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}${sep}`);
}

function lineAt(source: string, offset: number): number {
	return source.slice(0, offset).split('\n').length;
}

function forbiddenImports(scanRoot: string, forbiddenRoot: string): string[] {
	return productionSources(scanRoot).flatMap((path) => {
		const source = readFileSync(path, 'utf8');
		return sourceBlocks(path, source).flatMap((block) =>
			moduleReferences(block)
				.filter(({ specifier }) => {
					const target = resolveModule(path, specifier);
					return target !== null && isInside(target, forbiddenRoot);
				})
				.map(
					({ specifier, offset }) =>
						`${relative(SRC_ROOT, path)}:${lineAt(source, offset)} imports ${specifier}`,
				),
		);
	});
}

// Path denial is not capability denial: `$lib/v1/config`'s URL builders are re-exported from the
// `$lib/v1` barrel, so a specifier-only rule is evaded by importing the same function from there.
// This arm denies the CAPABILITY by binding name, whatever module it arrives through.
function forbiddenCapabilityImports(root: string, symbols: readonly string[]): string[] {
	const banned = new Set(symbols);
	return productionSources(root).flatMap((path) => {
		const source = readFileSync(path, 'utf8');
		return sourceBlocks(path, source).flatMap((block) => {
			const ast = ts.createSourceFile(
				'architecture-capability.ts',
				block.text,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TS,
			);
			const hits: string[] = [];
			const visit = (node: ts.Node): void => {
				if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
					const bindings = node.importClause.namedBindings;
					if (ts.isNamedImports(bindings)) {
						for (const element of bindings.elements) {
							// `propertyName` is the imported name when aliased (`import { a as b }`).
							const imported = (element.propertyName ?? element.name).text;
							if (!banned.has(imported)) continue;
							hits.push(
								`${relative(SRC_ROOT, path)}:${lineAt(source, block.offset + element.getStart(ast))} imports capability ${imported}`,
							);
						}
					} else if (ts.isNamespaceImport(bindings)) {
						// `import * as ns` hands over every export, including the banned ones.
						const specifier = ts.isStringLiteralLike(node.moduleSpecifier)
							? node.moduleSpecifier.text
							: '';
						const target = resolveModule(path, specifier);
						if (target !== null && isInside(target, V1_ROOT)) {
							hits.push(
								`${relative(SRC_ROOT, path)}:${lineAt(source, block.offset + bindings.getStart(ast))} namespace-imports ${specifier} (may expose ${symbols.join('/')})`,
							);
						}
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(ast);
			return hits;
		});
	});
}

function isDirectGlobalFetch(expression: ts.Expression): boolean {
	if (ts.isParenthesizedExpression(expression)) return isDirectGlobalFetch(expression.expression);
	if (
		ts.isBinaryExpression(expression) &&
		expression.operatorToken.kind === ts.SyntaxKind.CommaToken
	) {
		return isDirectGlobalFetch(expression.right);
	}
	if (ts.isIdentifier(expression)) return expression.text === 'fetch';
	if (
		ts.isElementAccessExpression(expression) &&
		ts.isIdentifier(expression.expression) &&
		expression.argumentExpression &&
		ts.isStringLiteralLike(expression.argumentExpression)
	) {
		return (
			expression.argumentExpression.text === 'fetch' &&
			['globalThis', 'self', 'window'].includes(expression.expression.text)
		);
	}
	return (
		ts.isPropertyAccessExpression(expression) &&
		expression.name.text === 'fetch' &&
		ts.isIdentifier(expression.expression) &&
		['globalThis', 'self', 'window'].includes(expression.expression.text)
	);
}

function v1Fetches(): string[] {
	return productionSources(V1_ROOT)
		.filter((path) => !isInside(path, ADAPTER_ROOT))
		.flatMap((path) => {
			const source = readFileSync(path, 'utf8');
			return sourceBlocks(path, source).flatMap((block) => {
				const ast = ts.createSourceFile(
					path,
					block.text,
					ts.ScriptTarget.Latest,
					true,
					ts.ScriptKind.TS,
				);
				const violations: string[] = [];
				const visit = (node: ts.Node): void => {
					if (ts.isCallExpression(node) && isDirectGlobalFetch(node.expression)) {
						violations.push(
							`${relative(SRC_ROOT, path)}:${lineAt(source, block.offset + node.getStart(ast))} calls global fetch`,
						);
					}
					ts.forEachChild(node, visit);
				};
				visit(ast);
				return violations;
			});
		});
}

describe('architecture boundaries', () => {
	it('keeps lib/v1 independent from app-runtime stores', () => {
		const violations = forbiddenImports(V1_ROOT, STORES_ROOT);
		expect(violations, violations.join('\n')).toEqual([]);
	});

	it('keeps generic components independent from product features', () => {
		const violations = forbiddenImports(COMPONENTS_ROOT, FEATURES_ROOT);
		expect(violations, violations.join('\n')).toEqual([]);
	});

	it('keeps v1 IO behind adapter ports', () => {
		const violations = [
			...forbiddenImports(REPOSITORIES_ROOT, V1_CONFIG_ROOT),
			...forbiddenCapabilityImports(REPOSITORIES_ROOT, URL_BUILDER_CAPABILITY),
			...v1Fetches(),
		];
		expect(violations, violations.join('\n')).toEqual([]);
	});
});
