import { getContext, setContext } from 'svelte';
import type { Locale } from './config';
import { DEFAULT_LOCALE } from './config';

const KEY = Symbol.for('transit.i18n.locale');

type LocaleReader = () => Locale;

export function setLocaleContext(locale: Locale | LocaleReader): void {
	const read: LocaleReader = typeof locale === 'function' ? locale : () => locale;
	setContext(KEY, read);
}

export function getLocale(): Locale {
	const read = getContext<LocaleReader | undefined>(KEY);
	return read ? read() : DEFAULT_LOCALE;
}
