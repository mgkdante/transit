import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'svelte/compiler';
import { expect, it } from 'vitest';
const root = resolve('src/lib');
function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? entry.name === '__fixtures__'
				? []
				: files(join(dir, entry.name))
			: entry.name.endsWith('.svelte')
				? [join(dir, entry.name)]
				: [],
	);
}
// Test harnesses are the only raw-control exemption; shared controls own their primitives.
const allowlist = new Set<string>();
function violations(source: string): string[] {
	const found = new Set<string>();
	function visit(node: unknown): void {
		if (!node || typeof node !== 'object') return;
		const n = node as {
			type?: string;
			name?: string;
			attributes?: { name: string; start: number; end: number }[];
			start: number;
			end: number;
		};
		if (n.type === 'RegularElement') {
			const attrs = n.attributes ?? [];
			const role = attrs.find((a) => a.name === 'role');
			const cls = attrs.find((a) => a.name === 'class');
			if (role && /role=["']tab(?:list)?["']/.test(source.slice(role.start, role.end)))
				found.add('hand-built tab');
			if (n.name === 'button' && cls && /pill|chip|tab/.test(source.slice(cls.start, cls.end)))
				found.add('raw pill or tab button');
		}
		for (const value of Object.values(node))
			if (Array.isArray(value)) value.forEach(visit);
			else if (value && typeof value === 'object') visit(value);
	}
	visit(parse(source, { modern: true }));
	return [...found];
}
it('rejects raw pill buttons and hand-built tab rows', () => {
	expect(violations('<button class="new-pill">Filter</button>')).toContain(
		'raw pill or tab button',
	);
	expect(violations('<div role="tablist"><button role="tab">Detail</button></div>')).toContain(
		'hand-built tab',
	);
	expect(violations('<button class="map-canvas-hit-target">Select</button>')).toEqual([]);
});
it('keeps map and detail controls on shared primitives', () => {
	const dirs = [
		'features/map',
		'features/stops',
		'features/lines',
		'features/trips',
		'features/network',
		'components/surface',
	];
	const problems = dirs
		.flatMap((dir) => files(join(root, dir)))
		.filter((file) => !allowlist.has(relative(root, file).replaceAll('\\', '/')))
		.flatMap((file) =>
			violations(readFileSync(file, 'utf8')).map((reason) => relative(root, file) + ': ' + reason),
		);
	expect(problems).toEqual([]);
});
