import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	Clusters: () => undefined,
	formatUtc: vi.fn((iso: string, locale: string) => `${locale}:${iso}`),
}));

vi.mock('$lib/features/lines/reliability/RouteReliabilityClusters.svelte', () => ({
	default: harness.Clusters,
}));
vi.mock('$lib/utils/time', () => ({ formatUtc: harness.formatUtc }));

const reliabilityIso = '2026-08-29T15:04:00Z';
const routeIso = '2026-08-28T15:04:00Z';
const data = {
	seed: { id: '24', name: '24 Sherbrooke' },
	routeSeed: { key: '24', data: { id: '24', generated_utc: routeIso } },
	reliabilitySeed: { key: '24', data: { id: '24', generated_utc: reliabilityIso, periods: [] } },
	lineHistorySeed: null,
};

async function loadWithBrowser(browser: boolean) {
	vi.resetModules();
	vi.doMock('$app/environment', () => ({ browser }));
	return (await import('./+page')).load;
}

afterEach(() => {
	vi.restoreAllMocks();
	harness.formatUtc.mockClear();
});

describe('line article time preparation', () => {
	it('prepares the selected reliability timestamp, then yields one browser task', async () => {
		const load = await loadWithBrowser(true);
		const parent = vi.fn(async () => ({ lang: 'fr' }));
		const timer = vi.spyOn(globalThis, 'setTimeout');
		const result = await load({
			data,
			url: new URL('https://transit.yesid.dev/fr/lines/24?tab=reliability'),
			parent,
		} as unknown as Parameters<typeof load>[0]);

		expect(result?.initialClusters).toBe(harness.Clusters);
		expect(result?.preparedArticleTime).toEqual({
			routeId: '24',
			iso: reliabilityIso,
			locale: 'fr',
			text: `fr:${reliabilityIso}`,
		});
		expect(harness.formatUtc).toHaveBeenCalledExactlyOnceWith(reliabilityIso, 'fr');
		expect(parent).toHaveBeenCalledOnce();
		expect(timer.mock.calls.filter(([, delay]) => delay === 0)).toHaveLength(1);
	});

	it('uses the route timestamp only when reliability has none', async () => {
		const load = await loadWithBrowser(true);
		const result = await load({
			data: { ...data, reliabilitySeed: { key: '24', data: null } },
			url: new URL('https://transit.yesid.dev/lines/24?tab=reliability'),
			parent: async () => ({ lang: 'en' }),
		} as unknown as Parameters<typeof load>[0]);
		expect(result?.preparedArticleTime).toMatchObject({ iso: routeIso, locale: 'en' });
		expect(harness.formatUtc).toHaveBeenCalledExactlyOnceWith(routeIso, 'en');
	});

	it('leaves server loading and inactive tabs free of preparation and yield', async () => {
		const load = await loadWithBrowser(false);
		const parent = vi.fn(async () => ({ lang: 'fr' }));
		const timer = vi.spyOn(globalThis, 'setTimeout');
		for (const tab of ['reliability', 'detail']) {
			const result = await load({
				data,
				url: new URL(`https://transit.yesid.dev/fr/lines/24?tab=${tab}`),
				parent,
			} as unknown as Parameters<typeof load>[0]);
			expect(result).not.toHaveProperty('preparedArticleTime');
		}
		expect(parent).not.toHaveBeenCalled();
		expect(harness.formatUtc).not.toHaveBeenCalled();
		expect(timer.mock.calls.filter(([, delay]) => delay === 0)).toHaveLength(0);
	});
});
