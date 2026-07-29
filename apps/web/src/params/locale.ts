import type { ParamMatcher } from '@sveltejs/kit';
import { isPrefixLocale } from '../lib/i18n/routing';

// SvelteKit matcher for the optional [[lang=locale]] segment. Accepts ONLY
// locales routable as prefixes (never 'en' — EN is unprefixed, and a match here
// would shadow every single-segment page like /search). Runs on server and
// client; the shared routing predicate reads PREFIX_LOCALES (currently ['fr']), so
// today this matches exactly 'fr'.
export const match: ParamMatcher = (value): boolean => isPrefixLocale(value);
