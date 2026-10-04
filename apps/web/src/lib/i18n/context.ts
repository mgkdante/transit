import { getContext, setContext } from 'svelte';
import type { Locale } from './config';
import { DEFAULT_LOCALE } from './config';
import { localizeHref } from './routing';

const KEY = Symbol.for('transit.i18n.locale');
const HREF_KEY = Symbol.for('transit.i18n.href');

type LocaleReader = () => Locale;

export function setLocaleContext(locale: Locale | LocaleReader, provider?: () => string): void {
	const read: LocaleReader = typeof locale === 'function' ? locale : () => locale;
	setContext(KEY, read);
	setContext(HREF_KEY, (href: string, lang: Locale) => localizeHref(href, lang, provider?.()));
}

export function getLocalizeHref(): typeof localizeHref {
	return getContext<typeof localizeHref | undefined>(HREF_KEY) ?? localizeHref;
}

export function getLocale(): Locale {
	const read = getContext<LocaleReader | undefined>(KEY);
	return read ? read() : DEFAULT_LOCALE;
}
