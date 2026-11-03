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
		const { default: Presentation } = await server.ssrLoadModule(
			'/src/lib/v1/live/__fixtures__/HealthPresentation.svelte',
		);
		const { render } = await server.ssrLoadModule('svelte/server');
		const html = render(Presentation).body;
		expect(html).toContain('data-stale="false"');
		expect(html).toContain('data-state="idle"');
		expect(html).toContain('unknown');
		expect(html).not.toContain('freshness-stamp-stale');
		expect(html).not.toContain('Data may be out of date.');
	} finally {
		await server.close();
	}
}, 30_000);
