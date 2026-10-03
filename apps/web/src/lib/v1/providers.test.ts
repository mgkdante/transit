import { expect, it, vi } from 'vitest';
import { loadProviderCatalog, PublicProviderCatalogSchema } from './providers';

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_V1_BASE: '/data/v1' } }));

const provider = {
	id: 'test',
	labels: {
		en: { city: 'Test City', operator: 'Test Transit' },
		fr: { city: 'Ville Test', operator: 'Transport Test' },
	},
	bbox: [20, 10, 21, 11],
	tz: 'America/Toronto',
	default_lang: 'en',
	attribution: 'Test data',
	basemap_url: '/data/v1/test/static/basemap/test.pmtiles',
	inputs: { static_schedule: true, trip_updates: true, service_alerts: false },
	alert_links: {},
};
const catalog = {
	schema_version: 1,
	generated_utc: '2026-10-03T00:00:00Z',
	default_provider: 'test',
	providers: [provider],
};

it('loads configured identities, geography and unavailable inputs without a known-city list', async () => {
	const fetcher = vi.fn(async () => new Response(JSON.stringify(catalog)));
	const loaded = await loadProviderCatalog(fetcher);
	expect(fetcher).toHaveBeenCalledWith('/data/v1/providers.json');
	expect(loaded.providers[0].labels.fr.city).toBe('Ville Test');
	expect(loaded.providers[0].bbox).toEqual([20, 10, 21, 11]);
	expect(loaded.providers[0].inputs.service_alerts).toBe(false);
});

it.each([
	{ ...catalog, providers: [] },
	{ ...catalog, default_provider: 'absent' },
	{ ...catalog, providers: [provider, provider] },
	{ ...catalog, providers: [{ ...provider, id: '../stm' }] },
	{ ...catalog, providers: [{ ...provider, bbox: [21, 11, 20, 10] }] },
])('rejects corrupt discovery instead of declaring a different selected provider', (value) => {
	expect(PublicProviderCatalogSchema.safeParse(value).success).toBe(false);
});

it('reports unavailable discovery without fetching default-provider data', async () => {
	const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
	await expect(loadProviderCatalog(fetcher)).rejects.toThrow('Provider catalog unavailable');
	expect(fetcher).toHaveBeenCalledTimes(1);
});
