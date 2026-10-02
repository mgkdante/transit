import type { RequestHandler } from './$types';
import { readPublicSiteConfig } from '$lib/site/config';
import { DEPLOYMENT_IDENTITY } from '$lib/site/deployment';

export const prerender = true;

export const GET: RequestHandler = () => {
	const short = readPublicSiteConfig().providerShortName ?? DEPLOYMENT_IDENTITY.providerShortName;
	const manifest = {
		name: `Transit · ${short} Analytics`,
		short_name: 'Transit',
		description: `Independent real-time ${short} network reliability, on-time performance and accountability dashboard.`,
		start_url: '/',
		scope: '/',
		display: 'standalone',
		orientation: 'any',
		background_color: '#141414',
		theme_color: '#141414',
		lang: 'en',
		dir: 'ltr',
		categories: ['travel', 'navigation', 'utilities'],
		icons: [
			{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
			{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
			{
				src: '/apple-touch-icon-180.png',
				sizes: '180x180',
				type: 'image/png',
				purpose: 'any',
			},
		],
	};
	return new Response(JSON.stringify(manifest, null, '\t'), {
		headers: { 'content-type': 'application/manifest+json' },
	});
};
