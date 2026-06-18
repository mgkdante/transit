// Single source of truth for the app's security response headers.
//
// WHY THIS EXISTS: the app deploys as a Cloudflare *Worker* (not Pages). The
// static `_headers` file is only applied by the assets binding to STATIC asset
// responses (favicon, fonts, /_app/immutable) — it does NOT decorate the
// SSR-rendered HTML *documents* emitted by `_worker.js`. So the pages a browser
// actually parses shipped ZERO security headers. We set them in hooks.server.ts
// on every rendered response, and keep `_headers` (the asset path) in lockstep
// via a parity test (securityHeaders.test.ts) so the two can't drift.
//
// CSP NOTES (verified against live behaviour):
//   • connect-src MUST include https://protomaps.github.io — MapLibre fetches
//     the basemap glyph PBFs from there (basemap.ts BASEMAP_GLYPHS_URL);
//     omitting it blanks every label on the live map.
//   • connect-src MUST include https://transit.yesid.dev — the /v1 snapshot
//     contract is read from PUBLIC_V1_BASE (absolute): cross-origin in dev,
//     same-origin in prod.
//   • worker-src blob: — pmtiles/maplibre spin up workers from blob URLs.
//   • script-src/style-src keep 'unsafe-inline' for the pre-paint theme IIFE in
//     app.html + Svelte's injected styles; tightening to nonce/hash is a tracked
//     follow-up.

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), payment=(), geolocation=(self)';
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
		'img-src': ["'self'", 'data:', 'blob:', 'https:'],
		'font-src': ["'self'"],
		'style-src': ["'self'", "'unsafe-inline'"],
		'script-src': ["'self'", "'unsafe-inline'"],
		'connect-src': ["'self'", 'https://transit.yesid.dev', 'https://protomaps.github.io'],
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

/** Production CSP — the exact policy shipped on documents AND (via _headers) assets. */
export function contentSecurityPolicy(): string {
	return serializeCsp(baseCspDirectives());
}

/**
 * Dev CSP — base policy plus vite HMR websocket + eval, so the map and app run
 * under a near-prod CSP locally instead of an un-enforced one. Prod stays tight.
 */
export function devContentSecurityPolicy(): string {
	const directives = baseCspDirectives();
	directives['connect-src'].push('ws:', 'wss:');
	directives['script-src'].push("'unsafe-eval'");
	return serializeCsp(directives);
}

/** All security headers as a record. `dev` relaxes ONLY the CSP for local HMR. */
export function securityHeaders({ dev }: { dev: boolean }): Record<string, string> {
	return {
		'X-Content-Type-Options': X_CONTENT_TYPE_OPTIONS,
		'Referrer-Policy': REFERRER_POLICY,
		'X-Frame-Options': X_FRAME_OPTIONS,
		'Permissions-Policy': PERMISSIONS_POLICY,
		'Strict-Transport-Security': STRICT_TRANSPORT_SECURITY,
		'Content-Security-Policy': dev ? devContentSecurityPolicy() : contentSecurityPolicy(),
	};
}
