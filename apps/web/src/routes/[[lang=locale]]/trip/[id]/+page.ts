import type { PageLoad } from './$types';
import { pathLocale } from '$lib/i18n';

// Trip surface loader — the ROUTING backbone only (slice-9.4).
//
// Surfaces the trip id from the route param + the path-derived locale. The live
// getTrips() read + lookup is owned by the trip feature slice (TripDetail); this
// loader stays a thin id+lang passthrough so the page route resolves and the
// surface renders its skeleton/stand-down. A trip is an EPHEMERAL live entity
// (ids rotate), so the page is marked noindex in the root layout and is NOT in
// the static sitemap PATHS.
export const load: PageLoad = ({ params, url }) => {
	return {
		id: params.id,
		lang: pathLocale(url.pathname),
	};
};
