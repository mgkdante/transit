import type { PublicSiteConfig } from './config';
import { emitAlternateSitemapEntries, emitSitemapDocument } from '@yesid/seo-kit/sitemap';

export { toW3CDate } from '@yesid/seo-kit/sitemap';

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
	'/privacy',
	'/terms',
] as const;

export const SITEMAP_URL_CAP = 50_000;

const ROUTE_PREFIX = '/lines/';
const STOP_PREFIX = '/stop/';

function entityPath(prefix: string, id: string): string {
	return `${prefix}${encodeURIComponent(id)}`;
}

export interface SitemapEntities {
	readonly routeIds?: readonly string[];
	readonly stopIds?: readonly string[];
	readonly entityLastmod?: string | null;
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

function localizedEntries(siteOrigin: string, path: string, lastmod: string | null): string[] {
	const en = `${siteOrigin}${path === '/' ? '/' : path}`;
	const fr = `${siteOrigin}/fr${path === '/' ? '' : path}`;
	return emitAlternateSitemapEntries({
		variants: [
			{ hreflang: 'en', href: en },
			{ hreflang: 'fr', href: fr },
		],
		xDefaultHref: en,
		lastmod,
		emptyElementStyle: 'compact',
	});
}

export function _sitemapEntries(siteOrigin: string, staticLastmod: string | null = null): string[] {
	return PATHS.flatMap((path) => localizedEntries(siteOrigin, path, staticLastmod));
}

export function _entitySitemapEntries(
	siteOrigin: string,
	prefix: string,
	ids: readonly string[],
	entityLastmod: string | null = null,
): string[] {
	return ids.flatMap((id) => localizedEntries(siteOrigin, entityPath(prefix, id), entityLastmod));
}

export function buildSitemapXml(config: PublicSiteConfig, entities: SitemapEntities = {}): string {
	const urls: string[] = config.indexing ? collectUrlBlocks(config.siteOrigin, entities) : [];

	return emitSitemapDocument(urls, { trailingNewline: true });
}

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

	const head = [...staticBlocks, ...routeBlocks];
	if (head.length >= SITEMAP_URL_CAP) return head.slice(0, SITEMAP_URL_CAP);
	const remaining = SITEMAP_URL_CAP - head.length;
	const evenRemaining = remaining - (remaining % 2);
	return [...head, ...stopBlocks.slice(0, evenRemaining)];
}
