import type { RequestHandler } from './$types';
import { readPublicSiteConfig } from '$lib/site/config';
import { buildSitemapXml } from '$lib/site/seoFiles';

// sitemap.xml — prerendered. Foundation scope: the public entry point in both
// locales, with hreflang alternates (Google's recommended bidirectional form).
// Dynamic stop/route pages aren't enumerable without data; they join the sitemap
// when those surfaces land (9.3+). The dev /_kit gallery is intentionally absent.
// Dev/staging builds set PUBLIC_INDEXING=false and emit an empty urlset.

export const prerender = true;

export const GET: RequestHandler = () => {
	return new Response(buildSitemapXml(readPublicSiteConfig()), {
		headers: { 'content-type': 'application/xml; charset=utf-8' },
	});
};
