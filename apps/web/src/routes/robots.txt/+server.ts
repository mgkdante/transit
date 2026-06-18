import type { RequestHandler } from './$types';
import { readPublicSiteConfig } from '$lib/site/config';
import { buildRobotsTxt } from '$lib/site/seoFiles';

// robots.txt — prerendered to a static file at build (no data deps).
// Production allows indexing; dev/staging builds set PUBLIC_INDEXING=false.

export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(buildRobotsTxt(readPublicSiteConfig()), {
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
