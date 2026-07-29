// Locale routing helpers — EN default unprefixed, FR `/fr` prefix.
//
// Adapted from yesid.dev slice-28.6 (apps/web/src/lib/utils/locale-routing.ts),
// re-themed to transit's i18n config. Shared mechanics come from
// @yesid/i18n-core; Transit keeps its locale levers, endpoint-exemption tail,
// route-segment syntax, and URL-state preservation local.

import { createLocaleRouting } from '@yesid/i18n-core';
import type { Locale } from './config';
import { DEFAULT_LOCALE, PREFIX_LOCALES } from './config';

/** The optional-param segment as it appears in SvelteKit route ids. */
const LOCALE_SEGMENT = '/[[lang=locale]]';

/** Endpoint/asset surfaces that are not localizable pages. */
function isPathExempt(path: string): boolean {
	const segment = path.replace(/^\/+/, '');

	if (
		segment.startsWith('api/') ||
		segment === 'sitemap.xml' ||
		segment === 'robots.txt' ||
		segment === 'manifest.webmanifest'
	) {
		return true;
	}

	return /\.[a-z0-9]+$/i.test(segment);
}

const routing = createLocaleRouting<Locale>({
	defaultLocale: DEFAULT_LOCALE,
	prefixLocales: PREFIX_LOCALES,
	isPathExempt,
	localeSegment: LOCALE_SEGMENT,
	preserveSearchAndHash: true,
});

/** Locale encoded in a pathname ('/fr/about' → 'fr'), else DEFAULT_LOCALE. */
export const pathLocale = routing.pathLocale;

/** '/fr/about' → '/about'; '/fr' → '/'; locale-less paths pass through. */
export const delocalizePath = routing.delocalizePath;

/**
 * Localize an internal page href for a target locale. Idempotent — any existing
 * locale prefix is stripped before the target one is applied, so
 * localizeHref('/fr/x', 'fr') === '/fr/x' and localizeHref('/x', 'en') === '/x'.
 * Exempt surfaces (external/anchor/scheme links, endpoints, asset files) pass
 * through untouched.
 */
export const localizeHref = routing.localizeHref;

/**
 * Localize a full URL for a target locale, PRESERVING its query string and hash.
 * The locale switcher uses this (not localizeHref) so in-progress URL state —
 * filters (?route=…&status=…), the active surface, anchors — survives an EN⇄FR
 * switch instead of being silently dropped. Path handling (prefix strip/re-add,
 * exemptions, idempotency) is delegated to localizeHref.
 */
export const localizeUrl: (url: URL, locale: Locale) => string = routing.localizeUrl;

/**
 * True when navigating from→to is a LOCALE SWITCH: the same canonical page in a
 * different locale (e.g. /about → /fr/about). The locale switcher produces
 * exactly these; consumers use it to gate snapshot/restore so a normal
 * navigation (to a different page) never triggers a state restore.
 */
export const isLocaleSwitch = routing.isLocaleSwitch;

/** '/[[lang=locale]]/about' → '/about' — route ids stay keyed by their
 *  canonical (unprefixed) form everywhere (route-seo, page lookups). */
export const stripLocaleSegment = routing.stripLocaleSegment;

/** True when a route segment is one of Transit's configured prefix locales. */
export const isPrefixLocale = routing.isPrefixLocale;
