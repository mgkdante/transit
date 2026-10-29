import { SECURITY_HEADERS, contentSecurityPolicy } from '@yesid/seo-kit/headers';

const BASEMAP_IMG_HOST = 'https://protomaps.github.io';
const OG_IMAGE_ORIGIN = 'https://transit.yesid.dev';
const SNAPSHOT_ORIGIN = 'https://data.yesid.dev';
const PLAUSIBLE_ORIGIN = 'https://plausible.io';

// The map's locate-me control needs geolocation; everything else stays denied.
export const PERMISSIONS_POLICY = SECURITY_HEADERS['Permissions-Policy']!.replace(
	'geolocation=()',
	'geolocation=(self)',
);

function cspDirectives(dev: boolean): Record<string, string[]> {
	return {
		'default-src': ["'self'"],
		'base-uri': ["'self'"],
		'object-src': ["'none'"],
		'frame-ancestors': ["'none'"],
		'img-src': ["'self'", 'data:', 'blob:', BASEMAP_IMG_HOST, OG_IMAGE_ORIGIN],
		'font-src': ["'self'"],
		'style-src': ["'self'", "'unsafe-inline'"],
		// 'unsafe-inline' covers SvelteKit's start script and the theme boot; adding any hash would switch it off.
		'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
		'connect-src': [
			"'self'",
			SNAPSHOT_ORIGIN,
			PLAUSIBLE_ORIGIN,
			BASEMAP_IMG_HOST,
			...(dev ? ['ws:', 'wss:'] : []),
		],
		'worker-src': ["'self'", 'blob:'],
		'manifest-src': ["'self'"],
		'upgrade-insecure-requests': [],
	};
}

export function contentSecurityPolicyFor({ dev }: { dev: boolean }): string {
	return contentSecurityPolicy(cspDirectives(dev));
}

export function securityHeaders({ dev }: { dev: boolean }): Record<string, string> {
	return {
		...SECURITY_HEADERS,
		'Permissions-Policy': PERMISSIONS_POLICY,
		'Content-Security-Policy': contentSecurityPolicyFor({ dev }),
	};
}
