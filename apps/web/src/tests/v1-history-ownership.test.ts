import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DateWindow as FilterDateWindow } from '$lib/filters';
import type { DateWindow as FilterStateDateWindow } from '$lib/filters/state';
import type { DateWindow as HistoryDateWindow } from '$lib/v1/history';
import type { DateWindow as V1DateWindow } from '$lib/v1';

const LIB_ROOT = resolve(process.cwd(), 'src/lib');
const V1_ROOT = resolve(LIB_ROOT, 'v1');

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		if (!/\.(?:svelte|ts)$/.test(entry.name) || entry.name.endsWith('.test.ts')) return [];
		return [path];
	});
}

describe('v1 history ownership', () => {
	it('owns DateWindow once and preserves every public type facade', () => {
		const owners = sourceFiles(LIB_ROOT)
			.filter((path) => /export interface DateWindow\s*{/.test(readFileSync(path, 'utf8')))
			.map((path) => relative(LIB_ROOT, path));

		expect(owners).toEqual(['v1/history/window.ts']);
		expectTypeOf<FilterDateWindow>().toEqualTypeOf<HistoryDateWindow>();
		expectTypeOf<FilterStateDateWindow>().toEqualTypeOf<HistoryDateWindow>();
		expectTypeOf<V1DateWindow>().toEqualTypeOf<HistoryDateWindow>();
	});

	it('keeps production v1 independent from the filter facade', () => {
		const reverseImports = sourceFiles(V1_ROOT)
			.filter((path) => /from ['"]\$lib\/filters(?:\/[^'"]*)?['"]/.test(readFileSync(path, 'utf8')))
			.map((path) => relative(V1_ROOT, path));

		expect(reverseImports).toEqual([]);
	});
});
