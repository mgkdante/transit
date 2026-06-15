import type { ParamMatcher } from '@sveltejs/kit';
import { PREFIX_LOCALES } from '$lib/i18n';

// SvelteKit matcher for the optional [[lang=locale]] segment. Accepts ONLY
// locales routable as prefixes (never 'en' — EN is unprefixed, and a match here
// would shadow every single-segment page like /search). Runs on server and
// client; PREFIX_LOCALES (currently ['fr']) is the single source of truth, so
// today this matches exactly 'fr'.
export const match: ParamMatcher = (value): boolean =>
	(PREFIX_LOCALES as readonly string[]).includes(value);
