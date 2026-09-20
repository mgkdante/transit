import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';

describe('selected reliability SSR', () => {
	it('renders the resolved component and range before client effects run', async () => {
		const server = await createServer({
			configFile: 'vite.config.ts',
			appType: 'custom',
			logLevel: 'silent',
			optimizeDeps: { noDiscovery: true },
			server: { middlewareMode: true },
		});
		try {
			const resources = (await server.ssrLoadModule(
				'/src/lib/v1/history/rangeResource.svelte.ts',
			)) as typeof import('./rangeResource.svelte');
			const loader = {
				loadIndex: vi.fn(async () => ({ id: 'accepted' })),
				availability: () => ({
					kind: 'continuous' as const,
					firstDate: '2026-01-01',
					lastDate: '2026-01-31',
					gaps: [],
				}),
				defaultWindow: () => ({ from: '2026-01-01', to: '2026-01-31' }),
				load: vi.fn(async () => ({ value: { count: 10 }, status: 'complete' as const })),
			};
			const request = resources.historyRangeRequestFromSearchParams(
				new URLSearchParams('from=2026-01-10&to=2026-01-20'),
			);
			const seed = await resources.loadHistoryRangeSeed(
				loader,
				request,
				new AbortController().signal,
			);
			const history = resources.createHistoryRangeResource(loader, {
				initialRequest: request,
				seed: () => seed,
			});
			expect(history.state).toBe('ready');
			expect(history.value).toEqual({ count: 10 });
			const { default: Pane } = await server.ssrLoadModule(
				'/src/lib/features/lines/LazyRouteReliabilityPane.svelte',
			);
			const { default: Clusters } = await server.ssrLoadModule(
				'/src/lib/features/lines/reliability/__fixtures__/RouteReliabilityClustersStub.svelte',
			);
			const { render } = await server.ssrLoadModule('svelte/server');
			const html = render(Pane, {
				props: {
					entityId: '24',
					resource: {
						data: { id: '24', generated_utc: '2026-01-31T12:00:00Z' },
						error: null,
						loading: false,
						settled: true,
						reload() {},
					},
					locale: 'fr',
					directionHeadsigns: { 0: 'Est' },
					history,
					initialClusters: Clusters,
				},
			}).body;
			expect(html).toContain('data-entity-id="24"');
			expect(html).toContain('data-history-state="ready"');
			expect(html).toContain('data-locale="fr"');
			expect(html).not.toContain('data-variant="skeleton"');
			expect(loader.loadIndex).toHaveBeenCalledTimes(1);
			expect(loader.load).toHaveBeenCalledTimes(1);
			history.destroy();

			const { load: universal } = await server.ssrLoadModule(
				'/src/routes/[[lang=locale]]/lines/[id]/+page.ts',
			);
			const { configureTransitUi } = await server.ssrLoadModule('/src/lib/ui/configure.ts');
			configureTransitUi();
			for (const [kind, from] of [
				['malformed', 'bad'],
				['outside', '2025-01-01'],
				['gap', '2026-01-15'],
				['missing-index', '2026-01-10'],
			] as const) {
				const fallbackLoader = {
					...loader,
					loadIndex: async () => (kind === 'missing-index' ? null : { id: 'accepted' }),
					availability: () => ({
						...loader.availability(),
						gaps: [{ start_date: '2026-01-15', end_date: '2026-01-15', reason: 'outage' }],
					}),
				};
				const url = new URL(
					`https://transit.yesid.dev/lines/24?tab=reliability&from=${from}&to=2026-01-20`,
				);
				const fallbackRequest = resources.historyRangeRequestFromSearchParams(url.searchParams);
				const fallbackSeed = await resources.loadHistoryRangeSeed(
					fallbackLoader,
					fallbackRequest,
					new AbortController().signal,
				);
				const fallbackHistory = resources.createHistoryRangeResource(fallbackLoader, {
					initialRequest: fallbackRequest,
					seed: () => fallbackSeed,
				});
				try {
					const current = {
						id: '24',
						generated_utc: '2026-01-31T12:00:00Z',
						periods: [{ grain: 'day', date: '2026-01-20', otp_pct: 80 }],
					};
					const data = await universal({
						url,
						data: {
							seed: { id: '24', name: '24' },
							routeSeed: null,
							reliabilitySeed: { key: '24', data: current },
							lineHistorySeed: { entityId: '24', ...fallbackSeed },
						},
					});
					expect(data.initialClusters, kind).toBeUndefined();
					expect(data.initialImportFailed).toBe(false);
					const fallbackHtml = render(Pane, {
						props: {
							entityId: '24',
							resource: { data: current, error: null, loading: false, settled: true, reload() {} },
							locale: 'en',
							directionHeadsigns: {},
							history: fallbackHistory,
							initialClusters: data.initialClusters,
						},
					}).body;
					expect(fallbackHtml, kind).toContain('data-variant="skeleton"');
					expect(fallbackHtml, kind).not.toContain('80%');
				} finally {
					fallbackHistory.destroy();
				}
			}
		} finally {
			await server.close();
		}
	}, 30000);
});
