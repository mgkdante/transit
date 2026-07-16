import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('card frame consistency', () => {
	it('keeps the shared card frame uniform on all four edges', () => {
		const card = read('src/lib/components/ui/card/card.svelte');

		expect(card).not.toMatch(/(?:box-shadow|filter)\s*:/i);
		expect(card).not.toContain('var(--edge-highlight)');
		expect(card).not.toMatch(/border-(?:top|block-start)\s*:/);
		expect(card).not.toMatch(/(?:linear|radial)-gradient\s*\(/i);
	});

	it('keeps listing inventory rules neutral instead of brand-coloured', () => {
		const stats = read('src/lib/components/layout/ListingHeaderStats.svelte');

		expect(stats).toContain('border-top: 1px solid var(--border);');
		expect(stats).not.toMatch(
			/border-top:[^;]*(?:border-brand|accent|primary|dataviz|edge-highlight)/,
		);
	});

	it('keeps state surfaces free of accent top-frame implementations', () => {
		const sources = [
			read('src/lib/components/edge/StateNotice.svelte'),
			read('src/lib/components/edge/EdgeState.svelte'),
		];

		for (const source of sources) {
			expect(source).not.toMatch(/border-(?:top|block-start)\s*:/);
			expect(source).not.toMatch(/(?:box-shadow|filter)\s*:/i);
			expect(source).not.toMatch(/(?:linear|radial)-gradient\s*\(/i);
			expect(source).not.toContain('edge-accent-bar');
			expect(source).not.toContain('--edge-rule');
		}
	});
});
