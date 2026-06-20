// jsonld — pure schema.org structured-data builders for the citizen dashboard.
//
// Each function returns a plain JSON-LD object (no Svelte, no DOM) that a caller
// serializes into a <script type="application/ld+json"> tag (see SeoHead). The
// WebSite node carries a SearchAction sitelinks-searchbox so Google can surface
// the in-site search; the target template points at /search?q={query}.
//
// BreadcrumbList nodes are built from the PATH trail (Home > Lines > <route>),
// not the entity name — the id segment (route number / stop code) is in the URL,
// so the trail is crawler-visible at SSR without the client-booted /v1 data. A
// richer per-entity leaf label (the line name / stop name) is data-dependent and
// remains a tracked follow-up (needs the data-binding SSR-seed).

import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';

/** Minimal structural typing for a schema.org node — every builder returns one. */
export interface JsonLdNode {
	'@context': 'https://schema.org';
	'@type': string;
	[key: string]: unknown;
}

/**
 * Open-data license for the transit dataset. The published /v1 snapshot is
 * derived from open GTFS / GTFS-rt feeds; we attribute under CC BY 4.0. The
 * manifest carries no license field today, so this is a module constant — the
 * single place a future per-provider license would override.
 */
export const DATASET_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

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

/** One crumb in a breadcrumb trail: a localized label and an absolute URL. */
export interface BreadcrumbItem {
	/** Already-localized, human-facing label (e.g. 'Lines', 'Lignes', '165'). */
	name: string;
	/** Absolute URL for this crumb (origin + locale-prefixed path). */
	url: string;
}

/**
 * BreadcrumbList node from an ordered trail (root-first). Each item becomes a
 * 1-based ListItem; the last crumb is the current page. Returns null for an
 * empty trail so callers can spread it away without emitting an empty node.
 */
export function breadcrumbJsonLd(items: readonly BreadcrumbItem[]): JsonLdNode | null {
	if (items.length === 0) return null;
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			name: item.name,
			item: item.url,
		})),
	};
}

interface OrganizationJsonLdInput {
	/** Absolute site origin (no trailing slash). */
	siteOrigin: string;
	/** Public-facing organization / brand name (matches og:site_name). */
	siteName: string;
}

/**
 * Organization node identifying the dashboard publisher. `url` is the site
 * origin; the same origin doubles as a stable `@id` so other nodes (Dataset
 * publisher/creator) can reference it without duplicating the object.
 */
export function organizationJsonLd({ siteOrigin, siteName }: OrganizationJsonLdInput): JsonLdNode {
	return {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		'@id': `${siteOrigin}#organization`,
		name: siteName,
		url: siteOrigin,
	};
}

interface DatasetJsonLdInput {
	/** Absolute site origin (no trailing slash). */
	siteOrigin: string;
	/** Publisher / brand name, reused as the dataset creator. */
	siteName: string;
	/** Dataset name (already localized by the caller). */
	name: string;
	/** Dataset description (already localized by the caller). */
	description: string;
	/** Active locale for inLanguage. Defaults to the unprefixed EN site. */
	locale?: Locale;
}

/**
 * Dataset node for the open transit data exposed through the /v1 contract.
 * `license` is CC BY 4.0; `creator` references the Organization node by @id so
 * the publisher is declared once. name/description are passed in localized so
 * the node matches the active locale's copy.
 */
export function datasetJsonLd({
	siteOrigin,
	siteName,
	name,
	description,
	locale = DEFAULT_LOCALE,
}: DatasetJsonLdInput): JsonLdNode {
	return {
		'@context': 'https://schema.org',
		'@type': 'Dataset',
		name,
		description,
		url: siteOrigin,
		inLanguage: locale,
		license: DATASET_LICENSE_URL,
		isAccessibleForFree: true,
		creator: {
			'@type': 'Organization',
			'@id': `${siteOrigin}#organization`,
			name: siteName,
			url: siteOrigin,
		},
	};
}
