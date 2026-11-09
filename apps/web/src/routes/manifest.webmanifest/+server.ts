import type { RequestHandler } from './$types';
import { DEPLOYMENT_IDENTITY } from '#lib/site/deployment.ts';

export const prerender = true;

export const GET: RequestHandler = () => {
	const manifest = {
		name: DEPLOYMENT_IDENTITY.name,
		short_name: DEPLOYMENT_IDENTITY.shortName,
		description:
			'Independent real-time transit network reliability, on-time performance and accountability dashboard.',
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
