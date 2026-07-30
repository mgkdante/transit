import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('root layout Footer gate', () => {
	it('renders Footer on document routes and omits it from the full-bleed map', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf-8');
		const footerGate = source.match(/\{#if !isFullBleed\}([\s\S]*?)\{\/if\}/)?.[1] ?? '';

		expect(source).toMatch(/const isFullBleed\s*=\s*\$derived\(seoPath\s*===\s*'\/map'\);/);
		expect(footerGate).toMatch(/<Footer\b[\s\S]*?\/>/);
		expect(source.match(/<Footer\b/g)).toHaveLength(1);
	});
});
