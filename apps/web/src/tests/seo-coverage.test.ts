import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATHS, buildSitemapXml } from '$lib/site/seoFiles';

interface CoverageDiffInput {
	expected: Iterable<string>;
	actual: Iterable<string>;
}

interface CoverageDiff {
	missing: string[];
	extra: string[];
}

interface TransitSeoGates {
	sitemapCoverage(input: CoverageDiffInput): CoverageDiff;
	ogCoverage(
		input: CoverageDiffInput & {
			identifiers?: Iterable<string>;
			isValidIdentifier?: (value: string) => boolean;
		},
	): CoverageDiff & { invalid: string[] };
}

async function loadSeoGates(): Promise<TransitSeoGates> {
	return (await import('@yesid/gates')) as unknown as TransitSeoGates;
}

describe('Transit-owned SEO coverage policy', () => {
	it('covers every configured static, route, and stop sitemap URL in both locales', async () => {
		const gates = await loadSeoGates();
		expect(typeof gates.sitemapCoverage).toBe('function');

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

		expect(gates.sitemapCoverage({ expected, actual })).toEqual({ missing: [], extra: [] });
	});

	it('covers exactly the supported Open Graph locales and rejects invalid locale ids', async () => {
		const gates = await loadSeoGates();
		expect(typeof gates.ogCoverage).toBe('function');

		const actual = readdirSync(resolve(process.cwd(), 'static/og'))
			.filter((file) => file.endsWith('.png'))
			.map((file) => file.slice(0, -'.png'.length));

		expect(
			gates.ogCoverage({
				expected: ['en', 'fr'],
				actual,
				identifiers: actual,
				isValidIdentifier: (locale) => locale === 'en' || locale === 'fr',
			}),
		).toEqual({ missing: [], extra: [], invalid: [] });
	});
});
