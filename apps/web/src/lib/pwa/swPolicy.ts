// swPolicy — the PURE request-routing decision logic for the service worker.
//
// This module has NO service-worker-runtime dependencies (no `self`, no
// `caches`, no `fetch`): it is plain, deterministic functions over URLs/strings
// so the SW's caching decisions are unit-testable WITHOUT a worker runtime.
// `src/service-worker.ts` imports these and wires them to the real Cache /
// fetch / registration APIs.
//
// SAFETY DOCTRINE (this SW is STICKY on a LIVE portfolio site)
//   - Navigations (HTML)      -> NETWORK-FIRST. Always fetch the live document;
//                                only fall back to a cached shell when OFFLINE.
//                                Guarantees the kill-switch + new code can always
//                                take effect (no stale-shell trap).
//   - /data/* + /v1 snapshots -> NEVER intercepted. Straight passthrough to the
//                                network so live transit data is never stale.
//   - App SHELL (hashed JS/CSS + static fonts/icons) -> cache-first (safe: the
//                                filenames are content-hashed / content-stable).
//   - Everything else (cross-origin, POST, Range) -> passthrough.

/** The path prefix under which the LIVE /v1 snapshot contract is served. */
export const DATA_PATH_PREFIX = '/data/';

/** The remote kill-flag path (same-origin, fetched with cache:'no-store'). */
export const KILL_FLAG_PATH = '/sw-kill.json';

/** Shape of the remote kill-flag document (static/sw-kill.json). */
export interface KillFlag {
	/** When true, the SW must tear itself down and unregister. */
	disabled?: boolean;
}

/**
 * Is this a request to the LIVE data origin (/data/* or any /v1 snapshot JSON)?
 *
 * Such requests MUST pass straight through to the network — never cached, never
 * served stale by the SW. We match the same-origin `/data/` path prefix (the
 * canonical mount, see vite.config.ts + _headers) and, defensively, any path
 * that contains a `/v1/` snapshot segment, so an alternate base never leaks live
 * data into a cache.
 *
 * @param url an already-parsed URL.
 */
export function isDataRequest(url: URL): boolean {
	const path = url.pathname;
	if (path === '/data' || path.startsWith(DATA_PATH_PREFIX)) return true;
	// Defensive: a `/v1/` snapshot segment anywhere in the path is live data too.
	if (path.includes('/v1/') || path.endsWith('/v1')) return true;
	return false;
}

/**
 * Is this the remote kill-flag request? It must never be cached or intercepted
 * by the shell logic — the SW fetches it itself with cache:'no-store'.
 */
export function isKillFlagRequest(url: URL): boolean {
	return url.pathname === KILL_FLAG_PATH;
}

/**
 * Is this a SHELL asset that is safe to cache-first?
 *
 * Only content-addressed build output and content-stable static files qualify:
 *   - `/_app/immutable/*` — SvelteKit's content-hashed JS/CSS (filename changes
 *     on every edit, so a forever-cache can never go stale).
 *   - the static asset set passed in `precachedAssets` (fonts, icons, favicon,
 *     manifest, offline page) — content-stable files precached on install.
 *
 * NOTE: HTML documents are deliberately NOT shell assets here — navigations are
 * network-first (see isNavigationRequest). Data requests are excluded up front.
 *
 * @param url             an already-parsed URL (same-origin).
 * @param precachedAssets the exact set of precached asset pathnames (from
 *                        $service-worker `build` + `files`), as pathnames.
 */
export function isShellAsset(url: URL, precachedAssets: ReadonlySet<string>): boolean {
	if (isDataRequest(url)) return false;
	if (isKillFlagRequest(url)) return false;
	const path = url.pathname;
	if (path.startsWith('/_app/immutable/')) return true;
	return precachedAssets.has(path);
}

/**
 * Is this request a top-level NAVIGATION (an HTML document load)?
 *
 * Navigations are network-first: we always try the live document so a fresh
 * shell (and therefore the kill-switch + any new code) loads on every visit.
 * We treat a request as a navigation when its `mode` is 'navigate' OR it
 * explicitly Accepts text/html (covers prefetch/SPA edge cases).
 *
 * @param req a minimal view of the request (mode + Accept header).
 */
export function isNavigationRequest(req: {
	mode?: string;
	headers?: { get(name: string): string | null };
}): boolean {
	if (req.mode === 'navigate') return true;
	const accept = req.headers?.get?.('accept') ?? '';
	return accept.includes('text/html');
}

/**
 * Should the SW handle this request at all?
 *
 * We ONLY take same-origin GET requests that are not Range requests. Everything
 * else (cross-origin, POST/PUT/…, Range/partial = pmtiles basemap) passes
 * straight through to the network untouched.
 *
 * @param req      minimal request view (method + headers).
 * @param url      the parsed request URL.
 * @param origin   the SW's own origin (self.location.origin).
 */
export function shouldHandle(
	req: { method?: string; headers?: { get(name: string): string | null } },
	url: URL,
	origin: string,
): boolean {
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') return false;
	if (url.origin !== origin) return false;
	// Range requests (partial content, e.g. pmtiles) must not be intercepted —
	// a cache match would break 206/Range semantics.
	if (req.headers?.get?.('range')) return false;
	// Live data is never our concern.
	if (isDataRequest(url)) return false;
	// The kill flag is fetched directly by the SW, never via the fetch handler.
	if (isKillFlagRequest(url)) return false;
	return true;
}

/**
 * Should this request be intercepted with `FetchEvent.respondWith()`?
 *
 * Passing the scope guard is not enough: the worker must also own a concrete
 * strategy for the request. Navigations use network-first and shell assets use
 * cache-first. Arbitrary same-origin GET requests are left to the browser
 * instead of being intercepted merely to call `fetch()` unchanged.
 */
export function shouldIntercept(
	req: {
		method?: string;
		mode?: string;
		headers?: { get(name: string): string | null };
	},
	url: URL,
	origin: string,
	precachedAssets: ReadonlySet<string>,
): boolean {
	if (!shouldHandle(req, url, origin)) return false;
	return isNavigationRequest(req) || isShellAsset(url, precachedAssets);
}

/**
 * Given a kill-flag payload (or a fetch failure), should the SW kill itself?
 *
 * The operator deploys `static/sw-kill.json` with `{"disabled": true}` to
 * remotely tear down a misbehaving SW. A network failure or a malformed body is
 * treated as NOT killed (fail-open) — we never tear down the SW just because the
 * flag was momentarily unreachable; only an explicit `disabled: true` kills it.
 *
 * @param flag the parsed kill-flag, or null/undefined on fetch/parse failure.
 */
export function shouldKill(flag: KillFlag | null | undefined): boolean {
	return flag?.disabled === true;
}

/**
 * The versioned cache name for a given $service-worker `version`. Bumping the
 * version (every deploy) yields a new cache; activate() deletes every cache that
 * isn't the current one, so old shells never linger.
 */
export function cacheNameFor(version: string): string {
	return `transit-shell-${version}`;
}

/**
 * Derive the set of precache PATHNAMES from the $service-worker asset URL lists.
 *
 * `build` + `files` are URL strings (may be relative like `./_app/...` or carry
 * the deployment base). We normalize each to a same-origin PATHNAME so the
 * runtime cache-key comparison in isShellAsset is apples-to-apples. The offline
 * fallback path is always included so a navigation while offline has something
 * honest to render.
 *
 * @param assetUrls    the concatenation of $service-worker `build` and `files`.
 * @param origin       the SW origin used to resolve relative URLs.
 * @param offlinePath  the offline fallback pathname to guarantee in the set.
 */
export function precachePathnames(
	assetUrls: readonly string[],
	origin: string,
	offlinePath: string,
): Set<string> {
	const out = new Set<string>();
	for (const raw of assetUrls) {
		try {
			out.add(new URL(raw, origin).pathname);
		} catch {
			// Skip anything that won't resolve to a URL — never throw at install.
		}
	}
	out.add(offlinePath);
	return out;
}
