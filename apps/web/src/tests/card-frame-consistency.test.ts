import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('card frame consistency', () => {
	it('keeps listing inventory rules neutral instead of brand-coloured', () => {
		const stats = read('src/lib/components/layout/ListingHeaderStats.svelte');

		expect(stats).toContain('border-top: 1px solid var(--border);');
		expect(stats).not.toMatch(
			/border-top:[^;]*(?:border-brand|accent|primary|dataviz|edge-highlight)/,
		);
	});
});
