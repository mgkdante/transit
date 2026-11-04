import type { RequestHandler } from './$types';
import { readPublicSiteConfig } from '#lib/site/config.ts';
import { buildRobotsTxt } from '#lib/site/seoFiles.ts';

export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(buildRobotsTxt(readPublicSiteConfig()), {
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
