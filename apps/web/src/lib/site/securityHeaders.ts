import { SECURITY_HEADERS } from '@yesid/seo-kit/headers';

/** Non-CSP headers for SSR responses; SvelteKit sets the CSP from kit.csp in svelte.config.js. */
export const DOCUMENT_SECURITY_HEADERS: Readonly<Record<string, string>> = {
	...SECURITY_HEADERS,
	// The map's locate-me control needs geolocation; everything else stays denied.
	'Permissions-Policy': SECURITY_HEADERS['Permissions-Policy']!.replace(
		'geolocation=()',
		'geolocation=(self)',
	),
};
