import type { PublicSiteConfig } from './config';

// Static surfaces — the always-present, data-independent pages. Per-entity URLs
// (/lines/[id], /stop/[id]) are NOT listed here; they are enumerated at request
// time by the dynamic sitemap handler (routes/sitemap.xml/+server.ts), which
// fetches the routes_index / stops_index over the DATA binding and passes the id
// lists into buildSitemapXml(). This module stays PURE — no fetch inside the lib.
export const PATHS = [
	'/',
	'/map',
	'/lines',
	'/stops',
	'/network',
	'/search',
	'/metrics',
	'/status',
	'/hotspots',
	'/receipt',
	'/repeat-offenders',
	'/alerts',
] as const;

// sitemaps.org caps a single sitemap file at 50,000 URLs / 50 MB. EN and FR are
// SEPARATE <url> elements, so each locale counts toward the cap (a 25k-entity
// provider emits 50k <url>s). STM is ~18k entities so a single file is fine, but
// the cap is enforced provider-agnostically below — see SITEMAP_URL_CAP usage.
// The 50,000-URL cap subsumes the 50 MB byte limit: 50k <url>s × the worst-case
// ~460 B/block ≈ 23 MB < 50 MB, so no separate byte guard is needed.
export const SITEMAP_URL_CAP = 50_000;

// Entity URL prefixes the app routes serve. Provider-agnostic — the id lists are
// supplied by the caller from the snapshot indexes, never hardcoded here.
const ROUTE_PREFIX = '/lines/';
const STOP_PREFIX = '/stop/';

// Percent-encode an entity id into a single path segment, EXACTLY matching how
// the app links to the entity. `routeFor()` (src/lib/nav/intent.svelte.ts) and
// `entityUrl()` (src/lib/v1/config.ts) both build the segment via
// `encodeURIComponent(id)`, so an id with a space/'/'/'#'/'?' becomes
// `%20`/`%2F`/`%23`/`%3F` and the sitemap <loc> == the app's real URL. The
// assembled URL is THEN XML-escaped by alternates()/urlBlock() (a separate
// concern: percent-encoding makes the URL valid; XML-escaping makes the
// document valid).
function entityPath(prefix: string, id: string): string {
	return `${prefix}${encodeURIComponent(id)}`;
}

/**
 * Per-entity id lists + a dataset-publish lastmod, threaded from the snapshot
 * indexes by the dynamic handler. All optional: when omitted (local dev / no
 * binding / fetch failed) the sitemap degrades to STATIC-only.
 */
export interface SitemapEntities {
	/** Route ids (RouteIndexEntry.id) → /lines/<id> + /fr/lines/<id>. */
	readonly routeIds?: readonly string[];
	/** Stop ids (StopIndexEntry.id) → /stop/<id> + /fr/stop/<id>. */
	readonly stopIds?: readonly string[];
	/**
	 * Dataset publish time (manifest static `generated_utc`) used as <lastmod> for
	 * entity pages. Omitted/empty → entity URLs carry NO lastmod (never fabricated).
	 */
	readonly entityLastmod?: string | null;
	/**
	 * Stable stamp for the static surfaces' <lastmod>. Omitted/empty → static URLs
	 * carry NO lastmod (never fabricated).
	 */
	readonly staticLastmod?: string | null;
}

export function buildRobotsTxt(config: PublicSiteConfig): string {
	if (!config.indexing) {
		return `User-agent: *
Disallow: /
`;
	}

	return `User-agent: *
Allow: /
Disallow: /_kit
Disallow: /fr/_kit
Disallow: /api/

Sitemap: ${config.siteOrigin}/sitemap.xml
`;
}

// --- XML escaping ------------------------------------------------------------

// Escape the five XML predefined entities so an id containing &, <, >, ', or "
// can't break the document (entity ids are provider-supplied free strings).
const XML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	"'": '&apos;',
	'"': '&quot;',
};

function xmlEscape(value: string): string {
	return value.replace(/[&<>'"]/g, (ch) => XML_ESCAPES[ch]);
}

// --- W3C date for <lastmod> --------------------------------------------------

/**
 * Normalize a candidate stamp to a W3C Datetime string for <lastmod>, or null
 * when there is no usable stamp. Honesty: never fabricates a date — a missing or
 * unparseable input yields null and the <url> omits <lastmod> entirely.
 */
export function toW3CDate(stamp: string | null | undefined): string | null {
	const raw = stamp?.trim();
	if (!raw) return null;
	const ms = Date.parse(raw);
	if (Number.isNaN(ms)) return null;
	return new Date(ms).toISOString();
}

// --- <url> block assembly ----------------------------------------------------

/** The hreflang alternate cluster (en / fr / x-default) for one path. */
function alternates(siteOrigin: string, path: string): string {
	const en = xmlEscape(`${siteOrigin}${path === '/' ? '/' : path}`);
	const fr = xmlEscape(`${siteOrigin}/fr${path === '/' ? '' : path}`);
	return (
		`    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>\n` +
		`    <xhtml:link rel="alternate" hreflang="fr" href="${fr}"/>\n` +
		`    <xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`
	);
}

/** One <url> block for `path`, EN canonical loc + alternates + optional lastmod. */
function urlBlock(siteOrigin: string, path: string, lastmod: string | null): string {
	const loc = xmlEscape(`${siteOrigin}${path === '/' ? '/' : path}`);
	const lastmodLine = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
	return `  <url>\n    <loc>${loc}</loc>${lastmodLine}\n${alternates(siteOrigin, path)}\n  </url>`;
}

/**
 * Exposed for testing: one <url> block per STATIC surface per locale (EN + /fr),
 * each carrying the xhtml:link alternate cluster and an optional <lastmod>.
 */
export function _sitemapEntries(siteOrigin: string, staticLastmod: string | null = null): string[] {
	const lastmod = toW3CDate(staticLastmod);
	// EN canonical + FR alternate as TWO separate <url> blocks (mirrors the prior
	// behaviour: one block per path/locale, both with the full alternate cluster).
	return PATHS.flatMap((path) => {
		const enBlock = urlBlock(siteOrigin, path, lastmod);
		// The FR block points its <loc> at the /fr URL but keeps the same cluster.
		const frLoc = xmlEscape(`${siteOrigin}/fr${path === '/' ? '' : path}`);
		const frLastmod = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
		const frBlock = `  <url>\n    <loc>${frLoc}</loc>${frLastmod}\n${alternates(siteOrigin, path)}\n  </url>`;
		return [enBlock, frBlock];
	});
}

/**
 * Exposed for testing: one <url> block per ENTITY per locale (EN + /fr) under
 * `prefix` (e.g. '/lines/'), each with the alternate cluster and optional
 * lastmod. The id is percent-encoded into the path segment (so the <loc> matches
 * the app's real link, e.g. a space → `%20`), THEN the assembled URL is
 * XML-escaped in both the <loc> and every alternate href.
 */
export function _entitySitemapEntries(
	siteOrigin: string,
	prefix: string,
	ids: readonly string[],
	entityLastmod: string | null = null,
): string[] {
	const lastmod = toW3CDate(entityLastmod);
	return ids.flatMap((id) => {
		// The path carries the PERCENT-ENCODED id segment (matching routeFor /
		// entityUrl). xmlEscape happens inside alternates()/urlBlock via the same
		// path string, so loc + hrefs are all percent-encoded then XML-escaped.
		const path = entityPath(prefix, id);
		const enBlock = urlBlock(siteOrigin, path, lastmod);
		const frLoc = xmlEscape(`${siteOrigin}/fr${path}`);
		const frLastmod = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
		const frBlock = `  <url>\n    <loc>${frLoc}</loc>${frLastmod}\n${alternates(siteOrigin, path)}\n  </url>`;
		return [enBlock, frBlock];
	});
}

/**
 * Build the full sitemap XML. PURE — no fetch. The dynamic handler wires the
 * binding fetch and passes the enumerated entity ids + lastmod stamps here.
 *
 * When indexing is disabled the sitemap is an EMPTY urlset (never the entity
 * list). Otherwise it is: static surfaces (×2 locales) + every route (×2) +
 * every stop (×2), capped at SITEMAP_URL_CAP urls.
 */
export function buildSitemapXml(config: PublicSiteConfig, entities: SitemapEntities = {}): string {
	const urls: string[] = config.indexing ? collectUrlBlocks(config.siteOrigin, entities) : [];

	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
		urls.join('\n') +
		`\n</urlset>\n`
	);
}

/**
 * Assemble the ordered <url> blocks, enforcing the 50k cap. Order is static →
 * routes → stops so that if the cap is hit, the always-present surfaces and the
 * (smaller) route set survive and only the tail of the stop list is dropped.
 *
 * 50k GUARD: sitemaps.org limits a single file to 50,000 URLs. STM is ~18k so a
 * single file is fine, but this caps provider-agnostically. When the cap would
 * be exceeded the over-cap tail (stops, then routes if even static+routes
 * overflow) is TRUNCATED — i.e. silently dropped — so the file stays valid.
 * Those entity pages simply won't appear in the sitemap until the real fix
 * lands. FOLLOW-UP: split into a <sitemapindex> of per-tier child sitemaps once
 * any provider's static + route + stop count exceeds 50k (then nothing drops).
 */
function collectUrlBlocks(siteOrigin: string, entities: SitemapEntities): string[] {
	const staticBlocks = _sitemapEntries(siteOrigin, entities.staticLastmod ?? null);
	const routeBlocks = _entitySitemapEntries(
		siteOrigin,
		ROUTE_PREFIX,
		entities.routeIds ?? [],
		entities.entityLastmod ?? null,
	);
	const stopBlocks = _entitySitemapEntries(
		siteOrigin,
		STOP_PREFIX,
		entities.stopIds ?? [],
		entities.entityLastmod ?? null,
	);

	const all = [...staticBlocks, ...routeBlocks, ...stopBlocks];
	if (all.length <= SITEMAP_URL_CAP) return all;

	// Over cap: keep static + routes, then fill with as many stops as fit.
	const head = [...staticBlocks, ...routeBlocks];
	// EDGE: if static + routes ALONE already exceed the cap, truncate `head`
	// itself rather than returning an over-cap list. (Only reachable past 50k —
	// never for STM.)
	if (head.length >= SITEMAP_URL_CAP) return head.slice(0, SITEMAP_URL_CAP);
	// Floor the stop budget to an EVEN number so an EN/FR entity pair is never
	// split — a lone EN <url> whose FR alternate 404s would be worse than dropping
	// both. _entitySitemapEntries emits the pair as [EN, FR] back-to-back.
	const remaining = SITEMAP_URL_CAP - head.length;
	const evenRemaining = remaining - (remaining % 2);
	return [...head, ...stopBlocks.slice(0, evenRemaining)];
}
