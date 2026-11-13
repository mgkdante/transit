import { expect, it, vi } from 'vitest';
import readyProviders from '../../../e2e/providers.json';
import {
	loadProviderCatalog,
	PublicProviderCatalogSchema,
	resolveProvider,
	providerHref,
	providerHasAlerts,
	routeHasNoLiveData,
} from './providers';

vi.mock('$app/env/public', async () => ({
	...(await import('./../../tests/publicEnv.ts')).PUBLIC_ENV,
	...{ PUBLIC_V1_BASE: '/data/v1' },
}));

const provider = {
	id: 'test',
	labels: {
		en: { city: 'Test City', operator: 'Test Transit' },
		fr: { city: 'Ville Test', operator: 'Transport Test' },
	},
	inputs: { static_schedule: true, trip_updates: true, service_alerts: false },
	alert_links: {},
};
const catalog = {
	schema_version: 1,
	generated_utc: '2026-10-03T00:00:00Z',
	default_provider: 'test',
	providers: [provider],
};

it.each([
	['Ottawa', { lat: 45.42, lon: -75.7 }, 'octranspo'],
	['Montréal', { lat: 45.5, lon: -73.6 }, 'stm'],
	['Toronto', { lat: 43.65, lon: -79.38 }, 'stm'],
	['missing location', null, 'stm'],
] as const)('selects the network for %s with STM as the fallback', (_city, location, expected) => {
	const ready = PublicProviderCatalogSchema.parse(readyProviders);
	const url = new URL('https://transit.test/fr/network?date=2026-11-10');
	const result = resolveProvider(url, ready, location);
	expect(result.provider.id).toBe(expected);
	expect(result.url.pathname + result.url.search).toBe(
		expected === 'stm'
			? '/fr/network?date=2026-11-10'
			: '/fr/network?date=2026-11-10&provider=octranspo',
	);
	expect(url.searchParams.has('provider')).toBe(false);
});

it.each([
	['provider=stm', 'stm'],
	['provider=octranspo', 'octranspo'],
	['provider=unknown', 'stm'],
	['provider=', 'stm'],
	['provider=stm&provider=octranspo', 'stm'],
])('keeps explicit provider policy above location for %s', (query, expected) => {
	const ready = PublicProviderCatalogSchema.parse(readyProviders);
	const result = resolveProvider(new URL(`https://transit.test/map?${query}`), ready, {
		lat: 45.42,
		lon: -75.7,
	});
	expect(result.provider.id).toBe(expected);
});

it('selects only ready providers and falls back when bounds are absent or ambiguous', () => {
	const ready = PublicProviderCatalogSchema.parse(readyProviders);
	const url = new URL('https://transit.test/');
	const location = { lat: 45.42, lon: -75.7 };
	const stm = ready.providers.find(({ id }) => id === 'stm')!;
	const ottawa = ready.providers.find(({ id }) => id === 'octranspo')!;
	for (const providers of [
		[stm],
		[stm, { ...ottawa, fit_bounds: null }],
		[stm, ottawa, { ...ottawa, id: 'overlap' }],
	]) {
		expect(resolveProvider(url, { ...ready, providers }, location).provider.id).toBe('stm');
	}
	expect(
		resolveProvider(
			url,
			{ ...ready, providers: [stm, { ...ottawa, id: 'new-provider' }] },
			location,
		).provider.id,
	).toBe('new-provider');
});

it('preserves provider-specific entities when automatic location selection chooses the network', () => {
	const result = resolveProvider(
		new URL('https://transit.test/fr/stop/123?lat=45.5&lon=-73.6'),
		PublicProviderCatalogSchema.parse(readyProviders),
		{ lat: 45.42, lon: -75.7 },
	);
	expect(result.url.pathname + result.url.search).toBe(
		'/fr/stop/123?lat=45.5&lon=-73.6&provider=octranspo',
	);
});

it('only disables alerts when both input families are explicitly unavailable', () => {
	expect(providerHasAlerts(undefined)).toBe(true);
	expect(providerHasAlerts({ ...provider, inputs: {} })).toBe(true);
	expect(
		providerHasAlerts({ ...provider, inputs: { i3_alerts: false, service_alerts: false } }),
	).toBe(false);
	expect(
		providerHasAlerts({ ...provider, inputs: { i3_alerts: true, service_alerts: false } }),
	).toBe(true);
});

it('selects any ready provider and normalizes unknown or duplicate choices to the catalog default', () => {
	const ready = PublicProviderCatalogSchema.parse({
		...catalog,
		providers: [provider, { ...provider, id: 'stm' }, { ...provider, id: 'octranspo' }],
	});
	expect(
		resolveProvider(new URL('https://transit.test/fr/map?provider=octranspo'), ready).provider.id,
	).toBe('octranspo');
	for (const query of ['provider=unknown', 'provider=stm&provider=octranspo']) {
		const selected = resolveProvider(new URL(`https://transit.test/fr/lines/42?${query}`), ready);
		expect(selected.provider.id).toBe('test');
		expect(selected.url.pathname + selected.url.search).toBe('/fr/lines/42?provider=test');
	}
	expect(
		providerHref(
			new URL('https://transit.test/fr/map?route=42&lat=45&provider=stm#stop'),
			'octranspo',
		),
	).toBe('/fr/map?provider=octranspo');
});

it('loads configured identities and unavailable inputs without a known-city list', async () => {
	const fetcher = vi.fn(async () => new Response(JSON.stringify(catalog)));
	const loaded = await loadProviderCatalog(fetcher);
	expect(fetcher).toHaveBeenCalledWith('/data/v1/providers.json');
	expect(loaded.providers[0].labels.fr.city).toBe('Ville Test');
	expect(loaded.providers[0].inputs.service_alerts).toBe(false);
});

it.each([
	{ ...catalog, schema_version: 2 },
	{ ...catalog, providers: [] },
	{ ...catalog, default_provider: 'absent' },
	{ ...catalog, providers: [provider, provider] },
	{ ...catalog, providers: [{ ...provider, id: '../stm' }] },
	{ ...catalog, providers: [{ ...provider, fit_bounds: [21, 11, 20, 10] }] },
])('rejects corrupt discovery instead of declaring a different selected provider', (value) => {
	expect(PublicProviderCatalogSchema.safeParse(value).success).toBe(false);
});

it('uses the canonical version default when the catalog omits it', () => {
	const { schema_version: _version, ...unversioned } = catalog;
	expect(PublicProviderCatalogSchema.parse(unversioned).schema_version).toBe(1);
});

it('reports unavailable discovery without fetching default-provider data', async () => {
	const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
	await expect(loadProviderCatalog(fetcher)).rejects.toThrow('Provider catalog unavailable');
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
	['stm', 1, true],
	['stm', 0, false],
	['stm', 3, false],
	['octranspo', 0, true],
	['octranspo', 1, false],
	['octranspo', 3, false],
	['unknown', 0, false],
	['constructor', 0, false],
	['__proto__', 1, false],
	[undefined, 1, false],
	['stm', null, false],
] as const)(
	'classifies provider %s route type %s without crossing providers',
	(provider, type, expected) => {
		expect(routeHasNoLiveData(provider, type)).toBe(expected);
	},
);
it.each([
	['stm', 1, 'metro_realtime'],
	['octranspo', 0, 'otrain_realtime'],
] as const)('uses published gaps when available for %s', (provider, type, gap) => {
	expect(routeHasNoLiveData(provider, type, [gap])).toBe(true);
	expect(routeHasNoLiveData(provider, type, [])).toBe(false);
	expect(routeHasNoLiveData(provider, type, ['unrelated'])).toBe(false);
});
