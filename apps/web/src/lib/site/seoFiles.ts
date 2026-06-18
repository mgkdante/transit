import type { PublicSiteConfig } from './config';

const PATHS = ['/'] as const;

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

export function buildSitemapXml(config: PublicSiteConfig): string {
	const urls = config.indexing
		? PATHS.flatMap((path) => {
				const en = `${config.siteOrigin}${path === '/' ? '/' : path}`;
				const fr = `${config.siteOrigin}/fr${path === '/' ? '' : path}`;
				return [en, fr].map(
					(loc) =>
						`  <url>\n    <loc>${loc}</loc>\n${alternates(config.siteOrigin, path)}\n  </url>`,
				);
			})
		: [];

	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
		urls.join('\n') +
		`\n</urlset>\n`
	);
}
