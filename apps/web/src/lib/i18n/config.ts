export type Locale = 'en' | 'fr';

export const DEFAULT_LOCALE: Locale = 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'fr'];

export const PREFIX_LOCALES: readonly Locale[] = ['fr'];

export const PUBLISHED_LOCALES: readonly Locale[] = ['en', 'fr'];

/** The Intl tag each locale formats numbers, dates and relative times with. */
export const INTL_TAGS: Readonly<Record<Locale, string>> = { en: 'en-CA', fr: 'fr-CA' };
