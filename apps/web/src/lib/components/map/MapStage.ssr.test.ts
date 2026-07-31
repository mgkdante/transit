// @vitest-environment node

import { expect, it } from 'vitest';
import { createServer } from 'vite';

it('renders no MapStage shell or browser-only state during SSR', async () => {
	const server = await createServer({
		configFile: 'vite.config.ts',
		appType: 'custom',
		logLevel: 'silent',
		optimizeDeps: { noDiscovery: true },
		server: { middlewareMode: true },
	});
	try {
		const stage = (await server.ssrLoadModule(
			'/src/lib/components/map/MapStage.svelte',
		)) as typeof import('./MapStage.svelte');
		const { render } = (await server.ssrLoadModule(
			'svelte/server',
		)) as typeof import('svelte/server');

		const body = render(stage.default).body;
		expect(body.replace(/<!--[\s\S]*?-->/gu, '')).toBe('');
		expect(body).not.toContain('map-stage');
	} finally {
		await server.close();
	}
}, 20_000);
