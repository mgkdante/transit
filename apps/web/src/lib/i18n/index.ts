// $lib/i18n — locale config, routing helpers, and the Svelte context bridge.
// Import everything i18n from here: `import { localizeHref, getLocale } from '$lib/i18n'`.

export type { Locale } from './config';
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, PREFIX_LOCALES, PUBLISHED_LOCALES } from './config';

export {
	localizeHref,
	localizeUrl,
	delocalizePath,
	pathLocale,
	isLocaleSwitch,
	stripLocaleSegment,
} from './routing';

export { setLocaleContext, getLocale } from './context';

export { defineCopy } from './copy';
