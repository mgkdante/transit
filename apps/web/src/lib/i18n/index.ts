export type { Locale } from './config';
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, PREFIX_LOCALES, PUBLISHED_LOCALES } from './config';

export {
	localizeHref,
	localizeUrl,
	delocalizePath,
	pathLocale,
	isLocaleSwitch,
	stripLocaleSegment,
	isPrefixLocale,
} from './routing';

export { setLocaleContext, getLocale, getLocalizeHref } from './context';

export { defineCopy } from './copy';
