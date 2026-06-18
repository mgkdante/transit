import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MapLiveFreshness', () => {
	const source = () =>
		readFileSync(resolve(process.cwd(), 'src/lib/features/map/MapLiveFreshness.svelte'), 'utf-8');

	it('centralizes map freshness placement so desktop and mobile do not duplicate visibly', () => {
		const s = source();

		expect(s).toContain("import { LiveFreshness } from '$lib/components/surface'");
		expect(s).toContain("placement: 'head' | 'floating'");
		expect(s).toContain('data-placement={placement}');
		expect(s).toContain('{#if hasFreshness}');
		expect(s).toMatch(/\.map-live-freshness\[data-placement='head'\]\s*\{[\s\S]*display:\s*none/);
		expect(s).toMatch(
			/\.map-live-freshness\[data-placement='floating'\]\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*calc\(var\(--map-detail-offset, 0rem\) \+ 1rem\)/,
		);
		expect(s).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.map-live-freshness\[data-placement='floating'\]\s*\{[\s\S]*display:\s*none/,
		);
		expect(s).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.map-live-freshness\[data-placement='head'\]\s*\{[\s\S]*display:\s*inline-flex/,
		);
	});
});
