import { describe, expect, it } from 'vitest';
import { buildRobotsTxt, buildSitemapXml } from './seoFiles';

describe('SEO static files', () => {
	it('allows production indexing and points at the configured sitemap', () => {
		const robots = buildRobotsTxt({
			siteOrigin: 'https://transit.yesid.dev',
			indexing: true,
		});

		expect(robots).toContain('Allow: /');
		expect(robots).toContain('Sitemap: https://transit.yesid.dev/sitemap.xml');
	});

	it('blocks crawlers and emits an empty sitemap when indexing is disabled', () => {
		const config = {
			siteOrigin: 'https://dev.transit.yesid.dev',
			indexing: false,
		};

		expect(buildRobotsTxt(config)).toBe('User-agent: *\nDisallow: /\n');
		expect(buildSitemapXml(config)).not.toContain('<url>');
	});

	it('uses the configured origin for localized sitemap entries', () => {
		const sitemap = buildSitemapXml({
			siteOrigin: 'https://dev.transit.yesid.dev',
			indexing: true,
		});

		expect(sitemap).toContain('<loc>https://dev.transit.yesid.dev/</loc>');
		expect(sitemap).toContain('<loc>https://dev.transit.yesid.dev/fr</loc>');
		expect(sitemap).toContain('hreflang="x-default" href="https://dev.transit.yesid.dev/"');
	});
});
