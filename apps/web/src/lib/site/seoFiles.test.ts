import { describe, expect, it } from 'vitest';
import {
	PATHS,
	SITEMAP_URL_CAP,
	_entitySitemapEntries,
	_sitemapEntries,
	buildRobotsTxt,
	buildSitemapXml,
	toW3CDate,
} from './seoFiles';
import { entityUrl } from '$lib/v1/config';

const SURFACES = [
	'/',
	'/map',
	'/lines',
	'/stops',
	'/network',
	'/search',
	'/metrics',
	'/status',
	'/hotspots',
	'/receipt',
	'/repeat-offenders',
	'/alerts',
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

	it('disallows the /_kit gallery and the /api/ endpoints', () => {
		const robots = buildRobotsTxt({
			siteOrigin: 'https://transit.yesid.dev',
			indexing: true,
		});

		expect(robots).toContain('Disallow: /_kit');
		expect(robots).toContain('Disallow: /fr/_kit');
		expect(robots).toContain('Disallow: /api/');
	});

	it('blocks crawlers and emits an empty sitemap when indexing is disabled', () => {
		const config = {
			siteOrigin: 'https://dev.transit.yesid.dev',
			indexing: false,
		};

		expect(buildRobotsTxt(config)).toBe('User-agent: *\nDisallow: /\n');
		expect(buildSitemapXml(config)).not.toContain('<url>');
		// Even with entity ids supplied, indexing=false yields an empty urlset.
		expect(buildSitemapXml(config, { routeIds: ['11'], stopIds: ['10001'] })).not.toContain(
			'<url>',
		);
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

		// Two locale URLs per surface, no more, no less (no entities supplied).
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

describe('sitemap entity enumeration', () => {
	const origin = 'https://transit.yesid.dev';

	it('emits /lines/<id> and /fr/lines/<id> for every route id, both locales', () => {
		const sitemap = buildSitemapXml(
			{ siteOrigin: origin, indexing: true },
			{ routeIds: ['11', '747'] },
		);

		expect(sitemap).toContain('<loc>https://transit.yesid.dev/lines/11</loc>');
		expect(sitemap).toContain('<loc>https://transit.yesid.dev/fr/lines/11</loc>');
		expect(sitemap).toContain('<loc>https://transit.yesid.dev/lines/747</loc>');
		expect(sitemap).toContain('<loc>https://transit.yesid.dev/fr/lines/747</loc>');
	});

	it('emits /stop/<id> and /fr/stop/<id> for every stop id, both locales', () => {
		const sitemap = buildSitemapXml({ siteOrigin: origin, indexing: true }, { stopIds: ['10001'] });

		expect(sitemap).toContain('<loc>https://transit.yesid.dev/stop/10001</loc>');
		expect(sitemap).toContain('<loc>https://transit.yesid.dev/fr/stop/10001</loc>');
	});

	it('counts static + routes + stops, each ×2 locales', () => {
		const sitemap = buildSitemapXml(
			{ siteOrigin: origin, indexing: true },
			{ routeIds: ['11', '747'], stopIds: ['10001', '10002', '10003'] },
		);

		const locCount = (sitemap.match(/<loc>/g) ?? []).length;
		// 12 surfaces + 2 routes + 3 stops = 17 entities x 2 locales = 34.
		expect(locCount).toBe((SURFACES.length + 2 + 3) * 2);
	});

	it('carries hreflang alternates incl. x-default on entity urls', () => {
		const sitemap = buildSitemapXml({ siteOrigin: origin, indexing: true }, { routeIds: ['11'] });

		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="en" href="https://transit.yesid.dev/lines/11"/>',
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="fr" href="https://transit.yesid.dev/fr/lines/11"/>',
		);
		expect(sitemap).toContain(
			'<xhtml:link rel="alternate" hreflang="x-default" href="https://transit.yesid.dev/lines/11"/>',
		);
	});

	it('percent-encodes ids (space + slash) then XML-escapes, matching the app link', () => {
		// An id containing a space AND a slash — both must be percent-encoded so the
		// sitemap <loc> equals how the app actually links to the entity.
		const id = 'A B/C';
		const entries = _entitySitemapEntries(origin, '/lines/', [id]);
		const [en, fr] = entries;

		// Percent-encoded segment: ' ' -> %20, '/' -> %2F (encodeURIComponent).
		const encoded = encodeURIComponent(id); // 'A%20B%2FC'
		expect(encoded).toBe('A%20B%2FC');
		expect(en).toContain(`<loc>${origin}/lines/${encoded}</loc>`);
		expect(en).toContain(`hreflang="en" href="${origin}/lines/${encoded}"`);
		expect(en).toContain(`hreflang="x-default" href="${origin}/lines/${encoded}"`);
		expect(fr).toContain(`<loc>${origin}/fr/lines/${encoded}</loc>`);

		// The raw space and slash must NOT survive in the path segment.
		expect(en).not.toContain('/lines/A B/C');

		// And the sitemap path segment matches entityUrl()'s id encoding exactly:
		// both build the segment via encodeURIComponent(id), so sitemap URL == app
		// URL (entityUrl appends .json for the snapshot file; the id segment is 1:1).
		expect(entityUrl('static', 'static/routes/', id)).toContain(`static/routes/${encoded}.json`);
	});

	it('percent-encodes then XML-escapes ids with reserved chars in <loc> and hrefs', () => {
		// An id with all five XML-reserved chars: &, <, >, ', ". The id is FIRST
		// percent-encoded (encodeURIComponent: & -> %26, < -> %3C, > -> %3E,
		// " -> %22; ' is left as-is by encodeURIComponent) so the URL is valid, THEN
		// the assembled URL is XML-escaped so the document is valid (the surviving
		// raw ' becomes &apos;). This mirrors the app link exactly.
		const nasty = `a&b<c>d'e"f`;
		const encoded = encodeURIComponent(nasty); // a%26b%3Cc%3Ed'e%22f
		const escaped = encoded.replace(/'/g, '&apos;'); // XML-escape the lone surviving '
		const entries = _entitySitemapEntries(origin, '/lines/', [nasty]);
		const en = entries[0];

		// Raw reserved chars must NOT appear inside the path segment.
		expect(en).toContain(`<loc>https://transit.yesid.dev/lines/${escaped}</loc>`);
		// And the alternate hrefs are encoded+escaped too.
		expect(en).toContain(`hreflang="en" href="https://transit.yesid.dev/lines/${escaped}"`);
		expect(en).toContain(`hreflang="x-default" href="https://transit.yesid.dev/lines/${escaped}"`);
		// The FR alternate must also be encoded+escaped.
		const fr = entries[1];
		expect(fr).toContain(`<loc>https://transit.yesid.dev/fr/lines/${escaped}</loc>`);

		// No bare ampersand survives anywhere: encodeURIComponent turned the literal
		// '&' into '%26', and every remaining '&' is the start of an XML entity.
		expect(en.replace(/&(amp|lt|gt|apos|quot);/g, '')).not.toContain('&');
		// The sitemap path matches entityUrl()'s id encoding exactly.
		expect(entityUrl('static', 'static/routes/', nasty)).toContain(`static/routes/${encoded}.json`);
	});

	it('fails soft to static-only when no entity ids are supplied', () => {
		const sitemap = buildSitemapXml({ siteOrigin: origin, indexing: true });
		const locCount = (sitemap.match(/<loc>/g) ?? []).length;
		expect(locCount).toBe(SURFACES.length * 2);
		expect(sitemap).not.toContain('/lines/');
		expect(sitemap).not.toContain('/stop/');
		// Static URLs survive — never an empty 200.
		expect(sitemap).toContain('<loc>https://transit.yesid.dev/</loc>');
	});
});

describe('sitemap lastmod', () => {
	const origin = 'https://transit.yesid.dev';

	it('stamps entity and static urls with a W3C lastmod when supplied', () => {
		const sitemap = buildSitemapXml(
			{ siteOrigin: origin, indexing: true },
			{
				routeIds: ['11'],
				entityLastmod: '2026-06-20T07:00:00Z',
				staticLastmod: '2026-06-20T07:00:00Z',
			},
		);

		const w3c = new Date('2026-06-20T07:00:00Z').toISOString();
		expect(sitemap).toContain(`<lastmod>${w3c}</lastmod>`);
	});

	it('omits <lastmod> entirely when no stamp is available (never fabricated)', () => {
		const sitemap = buildSitemapXml({ siteOrigin: origin, indexing: true }, { routeIds: ['11'] });
		expect(sitemap).not.toContain('<lastmod>');
	});

	it('omits <lastmod> when the stamp is unparseable (honesty)', () => {
		const sitemap = buildSitemapXml(
			{ siteOrigin: origin, indexing: true },
			{ routeIds: ['11'], entityLastmod: 'not-a-date', staticLastmod: 'not-a-date' },
		);
		expect(sitemap).not.toContain('<lastmod>');
	});

	it('toW3CDate normalizes valid stamps and rejects empty/invalid ones', () => {
		expect(toW3CDate('2026-06-20T07:00:00Z')).toBe(new Date('2026-06-20T07:00:00Z').toISOString());
		expect(toW3CDate('')).toBeNull();
		expect(toW3CDate('   ')).toBeNull();
		expect(toW3CDate(null)).toBeNull();
		expect(toW3CDate(undefined)).toBeNull();
		expect(toW3CDate('garbage')).toBeNull();
	});
});

describe('sitemap 50k guard', () => {
	const origin = 'https://transit.yesid.dev';

	it('keeps a single file under the 50k url cap', () => {
		// Build a list that, ×2 locales, exceeds the cap: cap/2 + 100 stops.
		const overByStops = SITEMAP_URL_CAP / 2 + 100;
		const stopIds = Array.from({ length: overByStops }, (_, i) => `s${i}`);
		const routeIds = ['11', '747'];

		const sitemap = buildSitemapXml({ siteOrigin: origin, indexing: true }, { routeIds, stopIds });

		const locCount = (sitemap.match(/<loc>/g) ?? []).length;
		expect(locCount).toBeLessThanOrEqual(SITEMAP_URL_CAP);
	});

	it('preserves all static + route urls and only truncates the stop tail when over cap', () => {
		const overByStops = SITEMAP_URL_CAP / 2 + 100;
		const stopIds = Array.from({ length: overByStops }, (_, i) => `s${i}`);
		const routeIds = ['11', '747'];

		const sitemap = buildSitemapXml({ siteOrigin: origin, indexing: true }, { routeIds, stopIds });

		// Static + both routes survive.
		expect(sitemap).toContain('<loc>https://transit.yesid.dev/</loc>');
		expect(sitemap).toContain('<loc>https://transit.yesid.dev/lines/11</loc>');
		expect(sitemap).toContain('<loc>https://transit.yesid.dev/lines/747</loc>');
		// The first stop survives; the very last stop (deep tail) is dropped.
		expect(sitemap).toContain('<loc>https://transit.yesid.dev/stop/s0</loc>');
		expect(sitemap).not.toContain(`<loc>https://transit.yesid.dev/stop/s${overByStops - 1}</loc>`);
	});
});
