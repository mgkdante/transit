import { describe, expect, it } from 'vitest';
import { PATHS, _sitemapEntries, buildRobotsTxt, buildSitemapXml } from './seoFiles';

const SURFACES = [
	'/',
	'/map',
	'/lines',
	'/stops',
	'/network',
	'/search',
	'/metrics',
	'/status',
] as const;

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

	it('enumerates every static surface', () => {
		expect([...PATHS]).toEqual(SURFACES);
	});

	it('lists a <loc> for all static surfaces in both EN and FR', () => {
		const origin = 'https://transit.yesid.dev';
		const sitemap = buildSitemapXml({ siteOrigin: origin, indexing: true });

		for (const path of SURFACES) {
			const en = `${origin}${path === '/' ? '/' : path}`;
			const fr = `${origin}/fr${path === '/' ? '' : path}`;
			expect(sitemap).toContain(`<loc>${en}</loc>`);
			expect(sitemap).toContain(`<loc>${fr}</loc>`);
		}

		// Two locale URLs per surface, no more, no less.
		const locCount = (sitemap.match(/<loc>/g) ?? []).length;
		expect(locCount).toBe(SURFACES.length * 2);
	});

	it('carries hreflang alternates incl. x-default for every surface', () => {
		const origin = 'https://transit.yesid.dev';
		const sitemap = buildSitemapXml({ siteOrigin: origin, indexing: true });

		for (const path of SURFACES) {
			const en = `${origin}${path === '/' ? '/' : path}`;
			const fr = `${origin}/fr${path === '/' ? '' : path}`;
			expect(sitemap).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${en}"/>`);
			expect(sitemap).toContain(`<xhtml:link rel="alternate" hreflang="fr" href="${fr}"/>`);
			expect(sitemap).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`);
		}
	});

	it('emits one <url> block per surface per locale', () => {
		const entries = _sitemapEntries('https://transit.yesid.dev');
		expect(entries).toHaveLength(SURFACES.length * 2);
		for (const entry of entries) {
			expect(entry).toContain('<loc>');
			expect(entry).toContain('hreflang="x-default"');
		}
	});
});
