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
//   • img-src is 'self' data: blob: + the basemap host + the OG-image origin —
//     NOT a broad `https:` wildcard. The map bakes its vehicle/stop/pin sprites
//     CLIENT-SIDE (canvas → addImage, so data:/blob:) and fetches glyph PBFs over
//     connect-src, not img-src; protomaps.github.io stays whitelisted here purely
//     as defense-in-depth for any future basemap raster (sprite/tile) image. The
//     OG card (static/og/{lang}.png) is read from transit.yesid.dev — same-origin
//     in prod, explicit so a cross-origin scrape still resolves.
//   • script-src/style-src keep 'unsafe-inline' for the pre-paint theme IIFE in
//     app.html + Svelte's injected styles; tightening to nonce/hash is a tracked
//     follow-up. script-src also allows https://static.cloudflareinsights.com so
//     Cloudflare Web Analytics' beacon.min.js can load (else the CSP blocks it).
//
// TODO(security/csp-hardening): drop script-src 'unsafe-inline' in favor of a
// sha256-<hash> allowlist for the app.html pre-paint theme IIFE. This is a
// deliberate SEPARATE follow-up — it needs a Content-Security-Policy-Report-Only
// rollout first to confirm nothing else inline-injects before enforcing.

// Basemap glyph/raster host — kept in img-src as defense-in-depth (see CSP NOTES).
const BASEMAP_IMG_HOST = 'https://protomaps.github.io';
// OG-image origin — the social card lives at {origin}/og/{lang}.png. Same-origin
// in prod; listed so a cross-origin fetch (dev, scrapers) still resolves.
const OG_IMAGE_ORIGIN = 'https://transit.yesid.dev';
// Cloudflare Web Analytics — its beacon.min.js loads from this host; allowlisted
// in script-src so the CSP doesn't block it (operator keeps CF Web Analytics).
const CF_INSIGHTS_HOST = 'https://static.cloudflareinsights.com';

// Explicitly DENY powerful features the app never uses (defense-in-depth: an
// empty allowlist `feature=()` blocks it for the document and all frames). KEEP
// geolocation=(self) — the near-me feature needs it. We deliberately do NOT list
// browsing-topics / interest-cohort: browsers don't recognise those Permissions-
// Policy tokens and log a console warning for each, and the Topics/FLoC APIs are
// gated separately (they require an explicit opt-in document, not a deny token).
export const PERMISSIONS_POLICY =
	'accelerometer=(), bluetooth=(), camera=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), payment=(), serial=(), usb=(), geolocation=(self)';
export const CROSS_ORIGIN_OPENER_POLICY = 'same-origin';
// NOTE: Cross-Origin-Resource-Policy is intentionally OMITTED. `same-origin`
// would block social scrapers (Twitter/Facebook/Slack) from fetching our OG card
// at /og/{lang}.png cross-origin, breaking link previews. COOP (above) already
// isolates the browsing context, which is the win we want here.
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
		'Cross-Origin-Opener-Policy': CROSS_ORIGIN_OPENER_POLICY,
		'Permissions-Policy': PERMISSIONS_POLICY,
		'Strict-Transport-Security': STRICT_TRANSPORT_SECURITY,
		'Content-Security-Policy': dev ? devContentSecurityPolicy() : contentSecurityPolicy(),
	};
}
