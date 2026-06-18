import { describe, it, expect } from 'vitest';
import { resolveRouteSeo } from './routeSeo';

const PATHS = ['/', '/map', '/lines', '/stops', '/network', '/search', '/route/1', '/stop/5'];

describe('resolveRouteSeo', () => {
	it('returns a distinct title per surface (no more single global title)', () => {
		const titles = ['/', '/map', '/lines', '/stops', '/network', '/search'].map(
			(p) => resolveRouteSeo(p, 'en').title,
		);
		expect(new Set(titles).size).toBe(titles.length);
	});

	it('localizes, including locale-prefixed paths', () => {
		expect(resolveRouteSeo('/network', 'fr').title).toBe('Santé du réseau');
		expect(resolveRouteSeo('/fr/network', 'fr').title).toBe('Santé du réseau');
	});

	it('falls detail routes back to section-level SEO', () => {
		expect(resolveRouteSeo('/route/1', 'en').title).toBe('Line detail');
		expect(resolveRouteSeo('/stop/5', 'en').title).toBe('Stop detail');
	});

	it('keeps every description in the ~120–160 char SEO window', () => {
		for (const p of PATHS) {
			for (const l of ['en', 'fr'] as const) {
				const len = resolveRouteSeo(p, l).description.length;
				expect(len, `${p} ${l}: ${len} chars`).toBeGreaterThanOrEqual(120);
				expect(len, `${p} ${l}: ${len} chars`).toBeLessThanOrEqual(160);
			}
		}
	});
});
