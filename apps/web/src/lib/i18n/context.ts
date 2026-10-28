import { createLocaleContext } from '@yesid/ui/state';
import { getContext, setContext } from 'svelte';
import { DEFAULT_LOCALE, type Locale } from './config';
import { localizeHref } from './routing';

const locale = createLocaleContext<Locale>(DEFAULT_LOCALE);
const HREF_KEY = Symbol.for('transit.i18n.href');

export const getLocale = locale.get;

/** The root layout provides the request locale and the provider every in-app link keeps. */
export function setLocaleContext(read: () => Locale, provider: () => string): void {
	locale.provide(read);
	setContext(HREF_KEY, (href: string, lang: Locale) => localizeHref(href, lang, provider()));
}

export function getLocalizeHref(): typeof localizeHref {
	return getContext<typeof localizeHref | undefined>(HREF_KEY) ?? localizeHref;
}
