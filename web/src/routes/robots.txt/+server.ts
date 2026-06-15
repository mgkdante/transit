import type { RequestHandler } from './$types';

// robots.txt — prerendered to a static file at build (no data deps).
// Allow everything except the dev component gallery; point crawlers at the sitemap.
const SITE = 'https://transit.yesid.dev';

export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(
		`User-agent: *
Allow: /
Disallow: /_kit
Disallow: /fr/_kit

Sitemap: ${SITE}/sitemap.xml
`,
		{ headers: { 'content-type': 'text/plain; charset=utf-8' } },
	);
