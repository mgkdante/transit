import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MapFreshness', () => {
	const source = () =>
		readFileSync(resolve(process.cwd(), 'src/lib/features/map/MapFreshness.svelte'), 'utf-8');

	it('centralizes map freshness placement so desktop and mobile do not duplicate visibly', () => {
		const s = source();

		// The map shares the ONE site-wide FreshnessStamp (variant="live"), never a
		// bespoke chip — it only owns the placement chrome around it.
		expect(s).toContain("import { FreshnessStamp } from '$lib/components/surface'");
		expect(s).toContain('variant="live"');
		expect(s).toContain("placement: 'head' | 'floating'");
		expect(s).toContain('data-placement={placement}');
		expect(s).toContain('{#if hasFreshness}');
		expect(s).toMatch(/\.map-freshness\[data-placement='head'\]\s*\{[\s\S]*display:\s*none/);
		expect(s).toMatch(
			/\.map-freshness\[data-placement='floating'\]\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*calc\(var\(--map-detail-offset, 0rem\) \+ 1rem\)/,
		);
		expect(s).toMatch(
			/@media \(max-width: 768px\)[\s\S]*\.map-freshness\[data-placement='floating'\]\s*\{[\s\S]*display:\s*none/,
		);
		expect(s).toMatch(
			/@media \(max-width: 768px\)[\s\S]*\.map-freshness\[data-placement='head'\]\s*\{[\s\S]*display:\s*inline-flex/,
		);
	});
});
