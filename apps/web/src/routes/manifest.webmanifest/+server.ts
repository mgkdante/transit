import type { RequestHandler } from './$types';
import { readPublicSiteConfig } from '$lib/site/config';
import { DEPLOYMENT_IDENTITY } from '$lib/site/deployment';

// manifest.webmanifest — prerendered to a static file at build. Replaces the old
// checked-in static/manifest.webmanifest, whose name/description HARDCODED the
// provider (operator law 2026-07-09: provider identity comes from the deployment
// seam, never string literals). PUBLIC_PROVIDER_SHORT_NAME (per-deploy env) wins;
// the committed deployment seam is the fallback so a bare local build still
// renders the real instance identity.

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
