import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Endonyms and product names retain their official spelling in French copy.
const properNouns = ['English', 'Cloudflare Web Analytics', 'Plausible Analytics Cloud'];
const forbidden = /\b(?:Contains|pipeline|gate|trips?|voyages?|Slowest|BUILD|English)\b/gi;

it('keeps known English labels and voyage out of French copy objects', () => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const findings: string[] = [];
	const files = readdirSync(root, { recursive: true, withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() && /\.(ts|svelte)$/.test(entry.name) && !/test|fixture/i.test(entry.name),
		)
		.map((entry) => `${entry.parentPath}/${entry.name}`)
		.sort();
	for (const file of files) {
		const raw = readFileSync(file, 'utf8');
		const source = file.endsWith('.svelte')
			? [...raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script\s*>/gi)]
					.map((match) => match[1])
					.join('\n')
			: raw;
		const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		function visit(node: ts.Node, french = false) {
			if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'fr') {
				visit(node.initializer, true);
				return;
			}
			if (
				french &&
				(ts.isStringLiteralLike(node) ||
					ts.isTemplateMiddleOrTemplateTail(node) ||
					ts.isTemplateHead(node))
			) {
				if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
				const text = properNouns.reduce((value, name) => value.replaceAll(name, ''), node.text);
				const matches = text.match(forbidden);
				if (matches)
					findings.push(`${file.slice(root.length)}: ${matches.join(', ')} in ${node.text}`);
			}
			ts.forEachChild(node, (child) => visit(child, french));
		}
		visit(ast);
	}
	expect(files.length).toBeGreaterThan(0);
	expect(findings).toEqual([]);
});
