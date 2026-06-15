// Svelte context bridge for the request locale.
//
// WHY context, not page data, for deep call sites:
//   - components can read the active locale at init without prop-drilling;
//   - without a provider (component unit tests / isolated renders) getLocale()
//     returns DEFAULT_LOCALE, which is byte-identical to a hardcoded 'en' — zero
//     test churn.
// Call setLocaleContext once from the root layout during init. The stored value
// is a getter so a reactive ($derived / $state) source stays current for late
// readers; pass a plain Locale and it is wrapped in a constant getter.

import { getContext, setContext } from 'svelte';
import type { Locale } from './config';
import { DEFAULT_LOCALE } from './config';

const KEY = Symbol.for('transit.i18n.locale');

type LocaleReader = () => Locale;

/**
 * Provide the active locale to descendants. Call once from the root layout.
 * Accepts a plain Locale (snapshot) or a reader () => Locale (stays reactive).
 */
export function setLocaleContext(locale: Locale | LocaleReader): void {
	const read: LocaleReader = typeof locale === 'function' ? locale : () => locale;
	setContext(KEY, read);
}

/** Current request locale; DEFAULT_LOCALE when read without a provider. */
export function getLocale(): Locale {
	const read = getContext<LocaleReader | undefined>(KEY);
	return read ? read() : DEFAULT_LOCALE;
}
