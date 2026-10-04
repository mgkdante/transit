import { expect, it, vi } from 'vitest';
import {
	loadProviderCatalog,
	PublicProviderCatalogSchema,
	resolveProvider,
	providerHref,
} from './providers';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_V1_BASE: '/data/v1' } }));

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
		expect(selected.url.pathname + selected.url.search).toBe('/fr/lines?provider=test');
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
