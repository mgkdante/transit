const BASEMAP_IMG_HOST = 'https://protomaps.github.io';
const OG_IMAGE_ORIGIN = 'https://transit.yesid.dev';
const SNAPSHOT_ORIGIN = 'https://data.yesid.dev';
const CF_INSIGHTS_HOST = 'https://static.cloudflareinsights.com';

export const PERMISSIONS_POLICY =
	'accelerometer=(), bluetooth=(), camera=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), payment=(), serial=(), usb=(), geolocation=(self)';
export const CROSS_ORIGIN_OPENER_POLICY = 'same-origin';
export const STRICT_TRANSPORT_SECURITY = 'max-age=63072000; includeSubDomains; preload';
export const REFERRER_POLICY = 'strict-origin-when-cross-origin';
export const X_FRAME_OPTIONS = 'SAMEORIGIN';
export const X_CONTENT_TYPE_OPTIONS = 'nosniff';

type CspDirectives = Record<string, readonly string[]>;

function baseCspDirectives(): Record<string, string[]> {
	return {
		'default-src': ["'self'"],
		'base-uri': ["'self'"],
		'object-src': ["'none'"],
		'frame-ancestors': ["'self'"],
		'img-src': ["'self'", 'data:', 'blob:', BASEMAP_IMG_HOST, OG_IMAGE_ORIGIN],
		'font-src': ["'self'"],
		'style-src': ["'self'", "'unsafe-inline'"],
		'script-src': ["'self'", "'unsafe-inline'", CF_INSIGHTS_HOST],
		'connect-src': ["'self'", SNAPSHOT_ORIGIN, 'https://protomaps.github.io'],
		'worker-src': ["'self'", 'blob:'],
		'manifest-src': ["'self'"],
	};
}

function serializeCsp(directives: CspDirectives): string {
	const body = Object.entries(directives)
		.map(([name, sources]) => `${name} ${sources.join(' ')}`)
		.join('; ');
	return `${body}; upgrade-insecure-requests`;
}

export function contentSecurityPolicy(): string {
	return serializeCsp(baseCspDirectives());
}

export function devContentSecurityPolicy(): string {
	const directives = baseCspDirectives();
	directives['connect-src'].push('ws:', 'wss:');
	directives['script-src'].push("'unsafe-eval'");
	return serializeCsp(directives);
}

export function securityHeaders({ dev }: { dev: boolean }): Record<string, string> {
	return {
		'X-Content-Type-Options': X_CONTENT_TYPE_OPTIONS,
		'Referrer-Policy': REFERRER_POLICY,
		'X-Frame-Options': X_FRAME_OPTIONS,
		'Cross-Origin-Opener-Policy': CROSS_ORIGIN_OPENER_POLICY,
		'Permissions-Policy': PERMISSIONS_POLICY,
		'Strict-Transport-Security': STRICT_TRANSPORT_SECURITY,
		'Content-Security-Policy': dev ? devContentSecurityPolicy() : contentSecurityPolicy(),
	};
}
