// i18n configuration — the locale set + the two independent routing levers.
//
// TWO LEVERS, deliberately separate (adapted from yesid.dev slice-28.6):
//   PREFIX_LOCALES    = which locales RESOLVE as URL path prefixes. Routing-level.
//                       EN is never prefixed; only members here ever appear as
//                       a leading `/xx` segment (and must be covered by the
//                       src/params/locale.ts matcher).
//   PUBLISHED_LOCALES = which locales are ANNOUNCED to crawlers / offered in the
//                       locale switcher (hreflang, sitemap variants, canonicals).
// A locale's /xx routes work as soon as it joins PREFIX_LOCALES; flipping it into
// PUBLISHED_LOCALES is what makes it user-visible. Keeping them apart lets FR be
// QA'd live before it is announced.

/** Every locale the app can render. EN is the guaranteed fallback. */
export type Locale = 'en' | 'fr';

/** The default locale. Never carries a URL prefix; the fallback for every label. */
export const DEFAULT_LOCALE: Locale = 'en';

/** All locales the app intends to support, in display order. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'fr'];

/**
 * Locales that may appear as a URL path prefix. EN is intentionally absent —
 * it is served unprefixed. Add a locale here (plus a src/params/locale.ts
 * matcher entry) to open its `/xx` routing.
 */
export const PREFIX_LOCALES: readonly Locale[] = ['fr'];

/**
 * Locales announced to crawlers and offered in the locale switcher. A locale
 * can be in PREFIX_LOCALES (routable) without being here (announced) so it can
 * be staged live before launch.
 */
export const PUBLISHED_LOCALES: readonly Locale[] = ['en', 'fr'];
