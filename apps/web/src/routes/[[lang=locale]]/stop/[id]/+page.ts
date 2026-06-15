import type { PageLoad } from './$types';
import { pathLocale } from '$lib/i18n';

// Stop surface loader — the ROUTING backbone only.
//
// Surfaces the stop id from the route param + the path-derived locale. The
// actual /v1 reads (departures / schedule / reliability) are owned by the stop
// feature slice; this loader stays a thin id+lang passthrough so the page route
// resolves, deep-links work, and the tabs render their edge-state placeholders
// until the feature data is wired in.
export const load: PageLoad = ({ params, url }) => {
	return {
		id: params.id,
		lang: pathLocale(url.pathname),
	};
};
