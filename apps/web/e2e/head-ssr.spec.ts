import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

// Request HTML directly: crawler metadata must be correct before any browser JavaScript runs.
for (const locale of ['en', 'fr'] as const) {
	test(`${locale}: only a validated home query brands the server-rendered head`, async ({
		request,
	}) => {
		const home = locale === 'en' ? '/' : '/fr';
		const checkedImages = new Set<string>();
		const invalid = await request.get(`${home}?provider=unknown`, { maxRedirects: 0 });
		expect(invalid.status()).toBe(307);
		expect(invalid.headers().location).toBe(`${home}?provider=stm`);
		for (const [path, provider] of [
			[home, null],
			[`${home}?provider=stm`, 'STM'],
			[`${home}?provider=octranspo`, 'OC Transpo'],
			[`${locale === 'en' ? '' : '/fr'}/map?provider=octranspo`, null],
			[`${locale === 'en' ? '' : '/fr'}/status?provider=stm`, null],
		] as const) {
			const response = await request.get(path);
			expect(response.ok(), path).toBe(true);
			const html = await response.text();
			const head = html.slice(0, html.indexOf('</head>'));
			const title = head.match(/<title>(.*?)<\/title>/s)?.[1];
			expect(title, path).toBeTruthy();
			if (provider) expect(title, path).toContain(provider);
			else expect(head, path).not.toMatch(/\bSTM\b|OC Transpo|Montréal|Ottawa/);
			for (const field of ['og:title', 'twitter:title']) {
				const value = head.match(
					new RegExp(`<meta (?:property|name)="${field}" content="([^"]*)"`),
				)?.[1];
				expect(value, `${path}: ${field}`).toBe(title);
			}
			const robots = [...head.matchAll(/<meta name="robots" content="([^"]*)"/g)];
			expect(robots).toHaveLength(1);
			expect(robots[0]![1]).toBe('max-image-preview:large');
			const description =
				head.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? '';
			expect(description.length).toBeGreaterThanOrEqual(50);
			expect(description.length).toBeLessThanOrEqual(110);
			const image = head.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
			expect(image, path).toMatch(
				new RegExp(
					`/og/${provider ? `home/${provider === 'STM' ? 'stm' : 'octranspo'}.` : path.includes('/map') ? 'pages/map.' : path.includes('/status') ? 'pages/status.' : ''}${locale}\\.png\\?v=[a-f0-9]{16}$`,
				),
			);
			if (image && !checkedImages.has(image)) {
				checkedImages.add(image);
				const url = new URL(image);
				const asset = await request.get(url.pathname + url.search);
				expect(asset.ok()).toBe(true);
				expect(asset.headers()['content-type']).toContain('image/png');
				const bytes = await asset.body();
				expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
				expect(createHash('sha256').update(bytes).digest('hex').slice(0, 16)).toBe(
					url.searchParams.get('v'),
				);
			}
			expect(head, path).toContain(`rel="canonical" href="https://transit.yesid.dev${path}"`);
			const graph = JSON.parse(
				head.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1] ?? '{}',
			)['@graph'];
			expect(graph.find((node: { '@type': string }) => node['@type'] === 'Organization').name).toBe(
				'Transit',
			);
			const website = graph.find((node: { '@type': string }) => node['@type'] === 'WebSite');
			expect(website.name).toBe('Transit');
			const search = new URL(website.potentialAction.target.urlTemplate.replace('{query}', 'bus'));
			expect(search.pathname).toBe(`${locale === 'en' ? '' : '/fr'}/search`);
			expect(search.searchParams.get('provider')).toBe(
				new URL(path, 'https://transit.yesid.dev').searchParams.get('provider'),
			);
		}
	});
}

test('ephemeral and error documents keep a single noindex tag', async ({ request }) => {
	for (const path of ['/trip/example', '/fr/trip/example', '/missing-share-page']) {
		const response = await request.get(path);
		const html = await response.text();
		const head = html.slice(0, html.indexOf('</head>'));
		expect([...head.matchAll(/<meta name="robots"/g)], path).toHaveLength(1);
		expect(head, path).toContain('content="noindex,nofollow"');
		expect(head, path).not.toContain('max-image-preview:large');
	}
});
