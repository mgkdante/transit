import type { RequestHandler } from './$types';
import { readPublicSiteConfig } from '$lib/site/config';
import { buildRobotsTxt } from '$lib/site/seoFiles';

export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(buildRobotsTxt(readPublicSiteConfig()), {
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
