import type { PublicSiteConfig } from './config';

// Static surfaces only. Dynamic per-entity URLs (/route/[id], /stop/[id]) are
// deliberately omitted — enumerating them needs a build-time snapshot fetch.
// TODO: add per-route/per-stop URLs once a build-time snapshot read is wired in.
export const PATHS = ['/', '/map', '/lines', '/stops', '/network', '/search', '/metrics'] as const;

export function buildRobotsTxt(config: PublicSiteConfig): string {
	if (!config.indexing) {
		return `User-agent: *
Disallow: /
`;
	}

	return `User-agent: *
Allow: /
Disallow: /_kit
Disallow: /fr/_kit

Sitemap: ${config.siteOrigin}/sitemap.xml
`;
}

function alternates(siteOrigin: string, path: string): string {
	const en = `${siteOrigin}${path === '/' ? '/' : path}`;
	const fr = `${siteOrigin}/fr${path === '/' ? '' : path}`;
	return (
		`    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>\n` +
		`    <xhtml:link rel="alternate" hreflang="fr" href="${fr}"/>\n` +
		`    <xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`
	);
}

// Exposed for testing: one <url> block per surface per locale (EN + /fr),
// each carrying the xhtml:link alternate cluster.
export function _sitemapEntries(siteOrigin: string): string[] {
	return PATHS.flatMap((path) => {
		const en = `${siteOrigin}${path === '/' ? '/' : path}`;
		const fr = `${siteOrigin}/fr${path === '/' ? '' : path}`;
		return [en, fr].map(
			(loc) => `  <url>\n    <loc>${loc}</loc>\n${alternates(siteOrigin, path)}\n  </url>`,
		);
	});
}

export function buildSitemapXml(config: PublicSiteConfig): string {
	const urls = config.indexing ? _sitemapEntries(config.siteOrigin) : [];

	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
		urls.join('\n') +
		`\n</urlset>\n`
	);
}
