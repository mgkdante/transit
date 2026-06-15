import type { RequestHandler } from './$types';

// sitemap.xml — prerendered. Foundation scope: the public entry point in both
// locales, with hreflang alternates (Google's recommended bidirectional form).
// Dynamic stop/route pages aren't enumerable without data; they join the sitemap
// when those surfaces land (9.3+). The dev /_kit gallery is intentionally absent.
const SITE = 'https://transit.yesid.dev';

export const prerender = true;

// Locale-less canonical paths to publish.
const PATHS = ['/'];

function alternates(path: string): string {
	const en = `${SITE}${path === '/' ? '/' : path}`;
	const fr = `${SITE}/fr${path === '/' ? '' : path}`;
	return (
		`    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>\n` +
		`    <xhtml:link rel="alternate" hreflang="fr" href="${fr}"/>\n` +
		`    <xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`
	);
}

export const GET: RequestHandler = () => {
	const urls = PATHS.flatMap((path) => {
		const en = `${SITE}${path === '/' ? '/' : path}`;
		const fr = `${SITE}/fr${path === '/' ? '' : path}`;
		return [en, fr].map(
			(loc) => `  <url>\n    <loc>${loc}</loc>\n${alternates(path)}\n  </url>`,
		);
	});

	const body =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
		urls.join('\n') +
		`\n</urlset>\n`;

	return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
