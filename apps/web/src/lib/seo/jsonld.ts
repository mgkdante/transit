// jsonld — pure schema.org structured-data builders for the citizen dashboard.
//
// Each function returns a plain JSON-LD object (no Svelte, no DOM) that a caller
// serializes into a <script type="application/ld+json"> tag (see SeoHead). The
// WebSite node carries a SearchAction sitelinks-searchbox so Google can surface
// the in-site search; the target template points at /search?q={query}. Per-ENTITY
// BreadcrumbList nodes (a specific line/stop trail) are a tracked follow-up —
// they are data-dependent and load client-side today.

import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';

/** Minimal structural typing for a schema.org node — every builder returns one. */
export interface JsonLdNode {
	'@context': 'https://schema.org';
	'@type': string;
	[key: string]: unknown;
}

interface WebSiteJsonLdInput {
	/** Absolute site origin (no trailing slash), e.g. 'https://transit.yesid.dev'. */
	siteOrigin: string;
	/** Public-facing site name (matches og:site_name). */
	siteName: string;
	/** Active locale for inLanguage. Defaults to the unprefixed EN site. */
	locale?: Locale;
}

/**
 * WebSite node with a sitelinks-searchbox SearchAction. The target template
 * resolves to the in-site search surface; `{query}` is filled by the search
 * client and `query-input` declares it required.
 */
export function websiteJsonLd({
	siteOrigin,
	siteName,
	locale = DEFAULT_LOCALE,
}: WebSiteJsonLdInput): JsonLdNode {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: siteName,
		url: siteOrigin,
		inLanguage: locale,
		potentialAction: {
			'@type': 'SearchAction',
			target: {
				'@type': 'EntryPoint',
				urlTemplate: `${siteOrigin}/search?q={query}`,
			},
			'query-input': 'required name=query',
		},
	};
}
