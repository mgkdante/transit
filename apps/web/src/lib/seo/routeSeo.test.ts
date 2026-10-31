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
	'/privacy',
	'/terms',
	'/lines/1',
	'/stop/5',
	'/trip/example',
];

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
	'/privacy',
	'/terms',
];

const STM_IDENTITY = { id: 'stm', shortName: 'STM', city: 'Montréal' } as const;

describe('URL-scoped home sharing', () => {
	const ottawa = { id: 'octranspo', shortName: 'OC Transpo', city: 'Ottawa' };

	it.each([
		'/',
		'/map?provider=octranspo',
		'/network?provider=octranspo',
		'/fr/lines/55?provider=octranspo',
		'/stop/5?provider=octranspo',
	])('keeps %s neutral despite the selected provider', (path) => {
		const head = resolveRouteSeo(path, 'en', ottawa);
		expect(head.siteName).toBe('Transit');
		expect(head.title + head.description).not.toMatch(/OC Transpo|Ottawa/);
		expect(head.description).not.toMatch(/service alerts/i);
		expect(resolveRouteSeo(path, 'fr', ottawa).description).not.toMatch(/\bavis\b/i);
	});

	it('uses validated provider wording only on an explicitly scoped home URL', () => {
		expect(resolveRouteSeo('/?provider=octranspo', 'en', ottawa)).toMatchObject({
			title: 'OC Transpo network overview',
			siteName: 'Transit',
			providerId: 'octranspo',
		});
		expect(resolveRouteSeo('/fr?provider=stm', 'fr', STM_IDENTITY).title).toBe('Vue du réseau STM');
		expect(resolveRouteSeo('/fr?provider=octranspo', 'fr', ottawa).imagePath).toMatch(
			/^\/og\/home\/octranspo\.fr\.png\?v=[a-f0-9]{16}$/,
		);
		expect(resolveRouteSeo('/?provider=octranspo', 'en', ottawa).description).not.toMatch(
			/alerts/i,
		);
		expect(resolveRouteSeo('/map?provider=octranspo', 'en', ottawa).imagePath).toMatch(
			/^\/og\/en\.png\?v=[a-f0-9]{16}$/,
		);
	});

	it.each([
		'/?provider=unknown',
		'/?provider=',
		'/?provider=stm',
		'/?provider=octranspo&provider=octranspo',
	])('rejects unvalidated or ambiguous home sharing at %s', (path) => {
		const head = resolveRouteSeo(path, 'en', ottawa);
		expect(head.siteName).toBe('Transit');
		expect(head.providerId).toBeUndefined();
		expect(head.description).not.toContain('Ottawa');
	});
});

describe('resolveRouteSeo', () => {
	it('returns a distinct title per surface (no more single global title)', () => {
		const titles = SURFACE_PATHS.map((p) => resolveRouteSeo(p, 'en').title);
		expect(new Set(titles).size).toBe(titles.length);
	});

	it('keeps surface titles distinct when an unscoped URL has provider data', () => {
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

	it('keeps neutral descriptions nonempty and concise', () => {
		for (const p of PATHS) {
			for (const l of ['en', 'fr'] as const) {
				const len = resolveRouteSeo(p, l).description.length;
				expect(len, `${p} ${l}: ${len} chars`).toBeGreaterThan(0);
				expect(len, `${p} ${l}: ${len} chars`).toBeLessThanOrEqual(160);
			}
		}
	});

	it('keeps descriptions nonempty and concise when provider data is available', () => {
		for (const p of PATHS) {
			for (const l of ['en', 'fr'] as const) {
				const len = resolveRouteSeo(p, l, STM_IDENTITY).description.length;
				expect(len, `${p} ${l}: ${len} chars`).toBeGreaterThan(0);
				expect(len, `${p} ${l}: ${len} chars`).toBeLessThanOrEqual(160);
			}
		}
	});

	it('uses provider copy only for the explicitly scoped home page', () => {
		for (const l of ['en', 'fr'] as const) {
			const home = resolveRouteSeo('/?provider=stm', l, STM_IDENTITY).description;
			expect(home).toContain('STM');
			expect(home).toContain('Montréal');
			const network = resolveRouteSeo('/network?provider=stm', l, STM_IDENTITY);
			expect(network.description).not.toContain('STM');
			expect(network.description).not.toContain('Montréal');
			expect(network.providerId).toBe('stm');
		}
		expect(resolveRouteSeo('/?provider=stm', 'en', STM_IDENTITY).title).toBe(
			'STM network overview',
		);
		expect(resolveRouteSeo('/fr?provider=stm', 'fr', STM_IDENTITY).title).toBe('Vue du réseau STM');
	});

	it('keeps legal SEO provider-neutral even when an identity is available', () => {
		for (const path of ['/privacy', '/terms']) {
			for (const locale of ['en', 'fr'] as const) {
				const { description } = resolveRouteSeo(path, locale, STM_IDENTITY);
				expect(description).not.toContain('STM');
				expect(description).not.toContain('Montréal');
			}
		}
	});
});

describe('isEphemeralPath', () => {
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
		expect(resolveRouteSeo('/', 'en').title).toBe('Transit network overview');
		expect(resolveRouteSeo('/', 'fr').title).toBe('Vue d’ensemble du réseau');
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
	it('keeps an OC entity identity while its French metadata stays neutral', () => {
		const head = resolveRouteSeo('/fr/lines/5?provider=octranspo', 'fr', {
			id: 'octranspo',
			shortName: 'OC Transpo',
			city: 'Ottawa',
		});
		expect(head.title + head.description).not.toMatch(/OC Transpo|Ottawa/);
		expect(breadcrumbItemsForHead('/fr/lines/5', 'fr', ORIGIN, head.providerId).at(-1)?.url).toBe(
			`${ORIGIN}/fr/lines/5?provider=octranspo`,
		);
	});

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
			expect(description).toContain('CC BY 4.0');
		}
		expect(resolveDatasetSeo('en').name).not.toBe(resolveDatasetSeo('fr').name);
	});
});
