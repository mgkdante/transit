// v1 base-URL + provider config — the ONE place that knows where the snapshot
// contract lives. Everything under here (http.ts, adapter/**) builds URLs from
// `v1BaseUrl()` / `entityUrl()`; nothing below this module ever hardcodes the
// snapshot host (e.g. data.yesid.dev). Swap the deploy target by setting
// `PUBLIC_V1_BASE` at build time — the code never changes.
//
// Defaults:
//   PUBLIC_V1_BASE     '/data/v1'  — same-origin static path (Cloudflare Pages
//                                    serves the snapshot under /data/v1; the
//                                    leading segment ALREADY includes the `/v1`
//                                    contract version, matching the pipeline's
//                                    `{base}/v1/{provider}/...` publish layout).
//   PUBLIC_V1_PROVIDER 'stm'       — the active transit provider namespace.
//
// URL shape (mirrors db/snapshots/publish.py):
//   {base}/{provider}/{relativePath}
//   e.g. /data/v1/stm/static/routes/97.json
//        /data/v1/stm/live/network.json
//        /data/v1/stm/manifest.json
//
// `PUBLIC_*` env vars are read via SvelteKit's $env/dynamic/public, which types
// the bag as `{ [k: \`PUBLIC_${string}\`]: string | undefined }`. We use the
// dynamic (not static) module deliberately: both vars are OPTIONAL (they have
// code defaults below), and static/public would only type a var that a checked-in
// .env declares — there is none, so a static import would not typecheck. Dynamic
// resolves the same PUBLIC_* values and safely returns `undefined` when unset.

import { env } from '$env/dynamic/public';

/** Default base when PUBLIC_V1_BASE is unset. Same-origin, version-pinned. */
const DEFAULT_BASE = '/data/v1';

/** Default provider namespace when PUBLIC_V1_PROVIDER is unset. */
const DEFAULT_PROVIDER = 'stm';

/**
 * The /v1 snapshot base URL (no trailing slash).
 *
 * Reads `PUBLIC_V1_BASE` (build-time inlined), defaulting to `/data/v1`. May be
 * a same-origin path (`/data/v1`) or an absolute origin
 * (`https://data.example.dev/v1`) — the absolute host is supplied ONLY via the
 * env var, never written into source below this module.
 */
export function v1BaseUrl(): string {
	const raw = (env.PUBLIC_V1_BASE ?? DEFAULT_BASE).trim();
	return stripTrailingSlash(raw || DEFAULT_BASE);
}

/**
 * The active provider namespace segment (e.g. `stm`).
 *
 * Reads `PUBLIC_V1_PROVIDER` (build-time inlined), defaulting to `stm`.
 */
export function v1Provider(): string {
	const raw = (env.PUBLIC_V1_PROVIDER ?? DEFAULT_PROVIDER).trim();
	return trimSlashes(raw || DEFAULT_PROVIDER);
}

/**
 * Resolve a provider-relative snapshot path to a fully-qualified URL.
 *
 * Joins `{base}/{provider}/{relativePath}`. Use this for any manifest pointer
 * that is already a complete relative path (e.g. `manifest.files.live.network`
 * = `"live/network.json"`, or `manifest.labels[lang]` = `"labels/fr.json"`).
 *
 * @param relativePath provider-relative path from the manifest (no leading `/`).
 */
export function resolveUrl(relativePath: string): string {
	const rel = trimLeadingSlash(relativePath.trim());
	return `${v1BaseUrl()}/${v1Provider()}/${rel}`;
}

/**
 * Build a per-entity snapshot URL from a tier + manifest prefix + id.
 *
 * The pipeline publishes per-entity files under tier prefixes carried in the
 * manifest (e.g. `manifest.files.static.routes_prefix` = `"static/routes/"`,
 * `manifest.files.historic.route_reliability_prefix` =
 * `"historic/route_reliability/"`). This joins them into the full fetch URL:
 *
 *   {base}/{provider}/{prefix}{id}.json
 *   entityUrl('static', 'static/routes/', '97')
 *     -> /data/v1/stm/static/routes/97.json
 *
 * The `tier` argument documents intent and is not embedded separately — the
 * manifest prefix already carries the tier directory. A trailing `.json` is
 * appended unless the id already ends in `.json`.
 *
 * @param tier      logical tier the prefix belongs to (live | static | historic).
 * @param prefixKey the resolved manifest prefix string (NOT the manifest field
 *                  name) — already ends with `/`, e.g. `"static/routes/"`.
 * @param id        the entity id (route id, stop id, ISO date, ...).
 */
export function entityUrl(
	tier: 'live' | 'static' | 'historic',
	prefixKey: string,
	id: string,
): string {
	void tier; // tier is encoded inside prefixKey's directory; kept for call-site clarity.
	const prefix = ensureTrailingSlash(trimLeadingSlash(prefixKey.trim()));
	const leaf = encodeURIComponent(id).endsWith('.json')
		? encodeURIComponent(id)
		: `${encodeURIComponent(id)}.json`;
	return resolveUrl(`${prefix}${leaf}`);
}

// --- internal path helpers -------------------------------------------------

function stripTrailingSlash(s: string): string {
	return s.endsWith('/') ? s.slice(0, -1) : s;
}

function trimLeadingSlash(s: string): string {
	return s.startsWith('/') ? s.replace(/^\/+/, '') : s;
}

function trimSlashes(s: string): string {
	return s.replace(/^\/+/, '').replace(/\/+$/, '');
}

function ensureTrailingSlash(s: string): string {
	if (s === '') return s;
	return s.endsWith('/') ? s : `${s}/`;
}
