// Locale routing helpers — EN default unprefixed, FR `/fr` prefix.
//
// Adapted from yesid.dev slice-28.6 (apps/web/src/lib/utils/locale-routing.ts),
// re-themed to transit's i18n config. The page-registry exemption set from
// yesid.dev is replaced with a self-contained pass-through check (transit has no
// page registry): external URLs, protocol-relative links, fragment/scheme links
// and non-page endpoint surfaces (api/, sitemap.xml, robots.txt, *.json) are
// never localized.

import type { Locale } from './config';
import { DEFAULT_LOCALE, PREFIX_LOCALES } from './config';

const PREFIX_SET: ReadonlySet<string> = new Set(PREFIX_LOCALES);

/** The optional-param segment as it appears in SvelteKit route ids. */
const LOCALE_SEGMENT = '/[[lang=locale]]';

/** Endpoint/asset surfaces that are not localizable pages. */
function isExempt(path: string): boolean {
	// External, protocol-relative, fragment-only, or non-path (mailto:, tel:, etc.).
	if (!path.startsWith('/') || path.startsWith('//')) return true;
	const seg = path.replace(/^\/+/, '');
	if (
		seg.startsWith('api/') ||
		seg === 'sitemap.xml' ||
		seg === 'robots.txt' ||
		seg === 'manifest.webmanifest'
	) {
		return true;
	}
	// Raw data/asset files (e.g. /v1/network.json) are endpoints, not pages.
	return /\.[a-z0-9]+$/i.test(seg);
}

/** The leading path segment if it is a routable prefix locale, else null. */
function prefixOf(pathname: string): Locale | null {
	const seg = pathname.split('/')[1] ?? '';
	return PREFIX_SET.has(seg) ? (seg as Locale) : null;
}

/** Locale encoded in a pathname ('/fr/about' → 'fr'), else DEFAULT_LOCALE. */
export function pathLocale(pathname: string): Locale {
	return prefixOf(pathname) ?? DEFAULT_LOCALE;
}

/** '/fr/about' → '/about'; '/fr' → '/'; locale-less paths pass through. */
export function delocalizePath(pathname: string): string {
	if (pathname === '') return '/';
	const p = prefixOf(pathname);
	if (!p) return pathname;
	const rest = pathname.slice(p.length + 1);
	return rest === '' || rest === '/' ? '/' : rest;
}

/**
 * Localize an internal page href for a target locale. Idempotent — any existing
 * locale prefix is stripped before the target one is applied, so
 * localizeHref('/fr/x', 'fr') === '/fr/x' and localizeHref('/x', 'en') === '/x'.
 * Exempt surfaces (external/anchor/scheme links, endpoints, asset files) pass
 * through untouched.
 */
export function localizeHref(path: string, locale: Locale): string {
	if (isExempt(path)) return path;
	const base = delocalizePath(path);
	if (locale === DEFAULT_LOCALE || !PREFIX_SET.has(locale)) return base;
	return base === '/' ? `/${locale}` : `/${locale}${base}`;
}

/**
 * Localize a full URL for a target locale, PRESERVING its query string and hash.
 * The locale switcher uses this (not localizeHref) so in-progress URL state —
 * filters (?route=…&status=…), the active surface, anchors — survives an EN⇄FR
 * switch instead of being silently dropped. Path handling (prefix strip/re-add,
 * exemptions, idempotency) is delegated to localizeHref.
 */
export function localizeUrl(url: URL, locale: Locale): string {
	return localizeHref(url.pathname, locale) + url.search + url.hash;
}

/**
 * True when navigating from→to is a LOCALE SWITCH: the same canonical page in a
 * different locale (e.g. /about → /fr/about). The locale switcher produces
 * exactly these; consumers use it to gate snapshot/restore so a normal
 * navigation (to a different page) never triggers a state restore.
 */
export function isLocaleSwitch(fromPathname: string, toPathname: string): boolean {
	return (
		delocalizePath(fromPathname) === delocalizePath(toPathname) &&
		pathLocale(fromPathname) !== pathLocale(toPathname)
	);
}

/** '/[[lang=locale]]/about' → '/about' — route ids stay keyed by their
 *  canonical (unprefixed) form everywhere (route-seo, page lookups). */
export function stripLocaleSegment(routeId: string): string {
	if (routeId === LOCALE_SEGMENT) return '/';
	if (routeId.startsWith(`${LOCALE_SEGMENT}/`)) return routeId.slice(LOCALE_SEGMENT.length);
	return routeId;
}
