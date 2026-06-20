import { describe, it, expect } from 'vitest';
import { resolveRouteSeo } from './routeSeo';

const PATHS = [
	'/',
	'/map',
	'/lines',
	'/stops',
	'/network',
	'/search',
	'/metrics',
	'/status',
	'/hotspots',
	'/receipt',
	'/repeat-offenders',
	'/alerts',
	'/route/1',
	'/stop/5',
];

// The full set of static surfaces (no detail routes) used by the title-
// distinctness checks — every entry here must render a unique <title>.
const SURFACE_PATHS = [
	'/',
	'/map',
	'/lines',
	'/stops',
	'/network',
	'/search',
	'/metrics',
	'/status',
	'/hotspots',
	'/receipt',
	'/repeat-offenders',
	'/alerts',
];

// A representative identity (STM / Montréal) for the keyworded-copy path. The
// module itself holds NO agency/city literals — these tokens are injected here.
const STM_IDENTITY = { shortName: 'STM', city: 'Montréal' } as const;

describe('resolveRouteSeo', () => {
	it('returns a distinct title per surface (no more single global title)', () => {
		const titles = SURFACE_PATHS.map((p) => resolveRouteSeo(p, 'en').title);
		expect(new Set(titles).size).toBe(titles.length);
	});

	it('keeps surface titles distinct on the keyworded identity path too', () => {
		const titles = SURFACE_PATHS.map((p) => resolveRouteSeo(p, 'en', STM_IDENTITY).title);
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

	it('keeps every NEUTRAL description in the ~120–160 char SEO window', () => {
		for (const p of PATHS) {
			for (const l of ['en', 'fr'] as const) {
				const len = resolveRouteSeo(p, l).description.length;
				expect(len, `${p} ${l}: ${len} chars`).toBeGreaterThanOrEqual(120);
				expect(len, `${p} ${l}: ${len} chars`).toBeLessThanOrEqual(160);
			}
		}
	});

	it('keeps every KEYWORDED description in the ~120–160 char SEO window', () => {
		for (const p of PATHS) {
			for (const l of ['en', 'fr'] as const) {
				const len = resolveRouteSeo(p, l, STM_IDENTITY).description.length;
				expect(len, `${p} ${l}: ${len} chars`).toBeGreaterThanOrEqual(120);
				expect(len, `${p} ${l}: ${len} chars`).toBeLessThanOrEqual(160);
			}
		}
	});

	it('injects the provider tokens into the keyworded copy', () => {
		// Home + network anchor the keyword-preservation contract in both locales.
		for (const l of ['en', 'fr'] as const) {
			const home = resolveRouteSeo('/', l, STM_IDENTITY).description;
			expect(home).toContain('STM');
			expect(home).toContain('Montréal');
			const network = resolveRouteSeo('/network', l, STM_IDENTITY).description;
			expect(network).toContain('STM');
			expect(network).toContain('Montréal');
		}
		// Home title is the one keyworded title override.
		expect(resolveRouteSeo('/', 'en', STM_IDENTITY).title).toBe('Live STM map');
		expect(resolveRouteSeo('/', 'fr', STM_IDENTITY).title).toBe('Carte STM en direct');
	});

	it('uses neutral, agency-free copy when identity is absent or partial', () => {
		const partials = [
			undefined,
			{ shortName: 'STM' },
			{ city: 'Montréal' },
			{ shortName: '', city: '' },
			{ shortName: '  ', city: 'Montréal' },
		];
		for (const identity of partials) {
			for (const l of ['en', 'fr'] as const) {
				const { title, description } = resolveRouteSeo('/', l, identity);
				expect(description).not.toContain('STM');
				expect(description).not.toContain('Montréal');
				expect(title).not.toContain('STM');
			}
		}
		// The neutral home title stays distinct from the keyworded one.
		expect(resolveRouteSeo('/', 'en').title).toBe('Live transit map');
		expect(resolveRouteSeo('/', 'fr').title).toBe('Carte du réseau en direct');
	});
});
