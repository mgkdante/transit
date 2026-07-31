// @vitest-environment node

import { readable } from 'svelte/store';
import { expect, it } from 'vitest';
import { createServer } from 'vite';

it('/map server-compiles and renders without browser APIs', async () => {
	const server = await createServer({
		configFile: 'vite.config.ts',
		appType: 'custom',
		logLevel: 'silent',
		optimizeDeps: { noDiscovery: true },
		server: { middlewareMode: true },
	});
	try {
		const page = (await server.ssrLoadModule(
			'/src/routes/[[lang=locale]]/map/+page.svelte',
		)) as typeof import('./+page.svelte');
		const { render } = (await server.ssrLoadModule(
			'svelte/server',
		)) as typeof import('svelte/server');
		const context = new Map<unknown, unknown>([
			[
				Symbol.for('transit.v1.context'),
				() => ({ manifest: { files: { live: { ttl_s: 30 } } }, labels: {}, lang: 'en' }),
			],
			[Symbol.for('transit.i18n.locale'), () => 'en'],
			[
				'__svelte__',
				{
					page: readable({ url: new URL('http://localhost/map') }),
					navigating: readable(null),
					updated: readable(false),
				},
			],
		]);

		expect(render(page.default, { context }).body).toContain('map-hero');
	} finally {
		await server.close();
	}
}, 20_000);
