import { createLocaleRouting } from '@yesid/i18n-core';
import type { Locale } from './config';
import { DEFAULT_LOCALE, PREFIX_LOCALES } from './config';

const LOCALE_SEGMENT = '/[[lang=locale]]';

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

export const pathLocale = routing.pathLocale;

export const delocalizePath = routing.delocalizePath;

export function localizeHref(href: string, locale: Locale, provider?: string): string {
	const localized = routing.localizeHref(href, locale);
	if (!provider || !localized.startsWith('/') || localized.startsWith('//')) return localized;
	const url = new URL(localized, 'https://transit.local');
	if (isPathExempt(url.pathname)) return localized;
	url.searchParams.set('provider', provider);
	return url.pathname + url.search + url.hash;
}

export const localizeUrl: (url: URL, locale: Locale) => string = routing.localizeUrl;

export const isLocaleSwitch = routing.isLocaleSwitch;

export const stripLocaleSegment = routing.stripLocaleSegment;

export const isPrefixLocale = routing.isPrefixLocale;
