import { describe, it, expect } from 'vitest';
import {
	resolveRouteSeo,
	isEphemeralPath,
	resolveBreadcrumbTrail,
	breadcrumbItemsForHead,
	resolveDatasetSeo,
} from './routeSeo';

const ORIGIN = 'https://transit.yesid.dev';

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
	'/lines/1',
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
		expect(resolveRouteSeo('/lines/1', 'en').title).toBe('Line detail');
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
});

describe('isEphemeralPath', () => {
	// Guards the central "trip ids rotate → never index" promise: only /trip is
	// ephemeral; detail surfaces over STABLE ids (/route, /stop) stay indexable.
	it('flags trip detail (and its locale-prefixed form) as ephemeral', () => {
		expect(isEphemeralPath('/trip/x')).toBe(true);
		expect(isEphemeralPath('/fr/trip/x')).toBe(true);
	});

	it('keeps stable detail surfaces indexable', () => {
		expect(isEphemeralPath('/lines/1')).toBe(false);
		expect(isEphemeralPath('/stop/5')).toBe(false);
	});
});

describe('resolveRouteSeo — neutral copy fallback', () => {
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

describe('resolveBreadcrumbTrail', () => {
	it('builds Home > Lines > <id> for a route detail path', () => {
		const trail = resolveBreadcrumbTrail('/lines/165', 'en');
		expect(trail.map((c) => c.name)).toEqual(['Home', 'Lines', '165']);
		expect(trail.map((c) => c.path)).toEqual(['/', '/lines', '/lines/165']);
	});

	it('builds Home > Stops > <id> for a stop detail path, localized', () => {
		const trail = resolveBreadcrumbTrail('/fr/stop/52001', 'fr');
		expect(trail.map((c) => c.name)).toEqual(['Accueil', 'Arrêts', '52001']);
		expect(trail.map((c) => c.path)).toEqual(['/', '/stops', '/stop/52001']);
	});

	it('returns an empty trail for non-detail surfaces and bare detail paths', () => {
		expect(resolveBreadcrumbTrail('/', 'en')).toEqual([]);
		expect(resolveBreadcrumbTrail('/lines', 'en')).toEqual([]);
		expect(resolveBreadcrumbTrail('/lines/', 'en')).toEqual([]);
	});
});

describe('breadcrumbItemsForHead', () => {
	it('localizes crumb paths against the origin (fr gets the /fr prefix)', () => {
		const items = breadcrumbItemsForHead('/fr/lines/165', 'fr', ORIGIN);
		expect(items.map((i) => i.url)).toEqual([
			`${ORIGIN}/fr`,
			`${ORIGIN}/fr/lines`,
			`${ORIGIN}/fr/lines/165`,
		]);
	});

	it('emits unprefixed EN URLs and an empty array off-detail', () => {
		expect(breadcrumbItemsForHead('/lines/1', 'en', ORIGIN)[1].url).toBe(`${ORIGIN}/lines`);
		expect(breadcrumbItemsForHead('/network', 'en', ORIGIN)).toEqual([]);
	});
});

describe('resolveDatasetSeo', () => {
	it('returns localized, non-empty dataset name + description', () => {
		for (const l of ['en', 'fr'] as const) {
			const { name, description } = resolveDatasetSeo(l);
			expect(name.length).toBeGreaterThan(0);
			expect(description).toContain('/v1');
		}
		expect(resolveDatasetSeo('en').name).not.toBe(resolveDatasetSeo('fr').name);
	});
});
