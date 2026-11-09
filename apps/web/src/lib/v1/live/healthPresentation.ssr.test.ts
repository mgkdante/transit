import { expect, it } from 'vitest';
import { createServer } from 'vite';

it('server-renders an unloaded live label without a stale label or map warning', async () => {
	const server = await createServer({
		configFile: 'vite.config.ts',
		appType: 'custom',
		logLevel: 'silent',
		optimizeDeps: { noDiscovery: true },
		server: { middlewareMode: true },
	});
	try {
		const { configureTransitUi } = await server.ssrLoadModule('/src/lib/ui/configure.ts');
		configureTransitUi();
		const { createLiveStore } = await server.ssrLoadModule('/src/lib/v1/live/store.svelte.ts');
		const { livePresentation } = await server.ssrLoadModule('/src/lib/v1/live/livePresentation.ts');
		const { default: Stamp } = await server.ssrLoadModule(
			'/src/lib/components/surface/FreshnessStamp.svelte',
		);
		const { default: Banner } = await server.ssrLoadModule(
			'/src/lib/features/map/MapFeedStallBanner.svelte',
		);
		const { render } = await server.ssrLoadModule('svelte/server');
		const store = createLiveStore(
			{ files: { live: { ttl_s: 30 } } },
			{ families: ['vehicles', 'alerts'] },
		);
		const presentation = livePresentation({
			familyStates: store.familyStates,
			families: ['vehicles', 'alerts'],
			locale: 'en',
			page: 'map',
		});
		const html =
			render(Stamp, { props: { presentation: presentation.stamp, locale: 'en' } }).body +
			render(Banner, { props: { presentation } }).body;
		expect(html).toContain('data-stale="false"');
		expect(html).toContain('data-state="idle"');
		expect(html).toContain('unknown');
		expect(html).not.toContain('freshness-stamp-stale');
		expect(html).not.toContain('Data may be out of date.');
	} finally {
		await server.close();
	}
}, 30_000);
