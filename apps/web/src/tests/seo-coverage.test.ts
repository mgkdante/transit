import { describe, expect, it } from 'vitest';
import { sitemapCoverage } from '@yesid/gates';
import { PATHS, buildSitemapXml } from '$lib/site/seoFiles';

describe('Transit-owned SEO coverage policy', () => {
	it('covers every configured static, route, and stop sitemap URL in both locales', () => {
		const routeIds = ['11', '747'];
		const stopIds = ['10001'];
		const xml = buildSitemapXml(
			{ siteOrigin: 'https://transit.yesid.dev', indexing: true },
			{ routeIds, stopIds },
		);
		const actual = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
		const paths = [
			...PATHS,
			...routeIds.map((id) => `/lines/${encodeURIComponent(id)}`),
			...stopIds.map((id) => `/stop/${encodeURIComponent(id)}`),
		];
		const expected = paths.flatMap((path) => {
			const suffix = path === '/' ? '/' : path;
			const frenchSuffix = path === '/' ? '' : path;
			return [`https://transit.yesid.dev${suffix}`, `https://transit.yesid.dev/fr${frenchSuffix}`];
		});

		expect(sitemapCoverage({ expected, actual })).toEqual({ missing: [], extra: [] });
	});
});
