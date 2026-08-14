// @vitest-environment node

import { readable } from 'svelte/store';
import { expect, it } from 'vitest';
import { createServer } from 'vite';

it.each([
	{
		locale: 'en' as const,
		path: '/map',
		bodyCopy: 'Static, non-live basemap',
		button: 'Load live interactive map',
	},
	{
		locale: 'fr' as const,
		path: '/fr/map',
		bodyCopy: 'Fond de carte statique, pas en direct',
		button: 'Charger la carte interactive en direct',
	},
])(
	'$path server-compiles to the static-first map without browser APIs',
	async ({ locale, path, bodyCopy, button }) => {
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
					() => ({ manifest: { files: { live: { ttl_s: 30 } } }, labels: {}, lang: locale }),
				],
				[Symbol.for('transit.i18n.locale'), () => locale],
				[
					'__svelte__',
					{
						page: readable({ url: new URL(`http://localhost${path}`) }),
						navigating: readable(null),
						updated: readable(false),
					},
				],
			]);

			const rendered = render(page.default, { context });
			const body = rendered.body;
			expect(body).toContain('map-progressive');
			expect(body).toContain(bodyCopy);
			expect(body).toContain(button);
			expect(body).toContain('<button');
			expect(body).toContain('<noscript');
			expect(body).toContain('https://www.openstreetmap.org/copyright');
			expect(body).toContain('https://github.com/protomaps/basemaps');
			expect(body).not.toContain('map-hero');
			expect(body).not.toContain('NETWORK · LIVE');
			expect(body).not.toContain('RÉSEAU · EN DIRECT');
			expect(rendered.head).not.toContain('protomaps.github.io');
		} finally {
			await server.close();
		}
	},
	20_000,
);
