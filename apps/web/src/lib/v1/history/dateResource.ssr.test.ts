import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

const servers: ViteDevServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('createHistoryDateResource SSR', () => {
	it('exposes an inert resource before client effects initialize', async () => {
		const server = await createServer({
			configFile: 'vite.config.ts',
			appType: 'custom',
			logLevel: 'silent',
			optimizeDeps: { noDiscovery: true },
			server: { middlewareMode: true },
		});
		servers.push(server);
		const module = (await server.ssrLoadModule(
			'/src/lib/v1/history/dateResource.svelte.ts',
		)) as typeof import('./dateResource.svelte');
		const resource = module.createHistoryDateResource(
			{
				loadIndex: async () => null,
				availability: () => ({ kind: 'empty' }),
				loadCurrent: async () => ({ label: 'current' }),
				loadDate: async () => ({ label: 'retained' }),
			},
			{ initialRequest: { hasDate: false, rawDate: null } },
		);

		expect(resource.request).toEqual({ hasDate: false, rawDate: null });
		expect(resource.index).toBeNull();
		expect(resource.resolved).toBeNull();
		expect(resource.data).toBeNull();
		expect(resource.error).toBeNull();
		expect(resource.state).toBe('idle');
		expect(resource.loading).toBe(false);
		expect(resource.settled).toBe(false);
	}, 15_000);
});
