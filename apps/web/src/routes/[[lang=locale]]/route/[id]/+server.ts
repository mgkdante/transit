import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Legacy-URL 301 shim. The per-line detail surface was consolidated in S6 from
// /route/[id] to /lines/[id] so the lines surface has ONE canonical home (the
// `/lines` index AND every line's detail live under /lines). Old bookmarks,
// inbound links and search-index entries are redirected PERMANENTLY to the new
// canonical path, preserving the optional locale prefix and any query string.
//
// This directory holds ONLY this handler — the +page.svelte/+page.ts moved to
// ../../lines/[id]/ — so SvelteKit serves the redirect here, not a page (a route
// cannot have both a +page and a +server). The id is re-encoded with
// encodeURIComponent so the Location matches routeFor()'s canonical output
// exactly (e.g. an id with a space → %20).
export const GET: RequestHandler = ({ params, url }) => {
	const localePrefix = params.lang ? `/${params.lang}` : '';
	redirect(301, `${localePrefix}/lines/${encodeURIComponent(params.id)}${url.search}`);
};
