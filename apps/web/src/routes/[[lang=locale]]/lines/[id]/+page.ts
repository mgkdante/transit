import type { PageLoad } from './$types';
import { pathLocale } from '$lib/i18n';

// Route (line) surface loader — the ROUTING backbone only.
//
// Surfaces the route id from the param + the path-derived locale. The static
// route detail / schedule / historic reliability /v1 reads are owned by the line
// feature slice; this loader stays a thin id+lang passthrough so the page route
// resolves and the tabs render their edge-state placeholders until then.
export const load: PageLoad = ({ params, url }) => {
	return {
		id: params.id,
		lang: pathLocale(url.pathname),
	};
};
