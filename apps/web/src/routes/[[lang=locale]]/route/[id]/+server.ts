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

// HEAD parity: a +server.ts endpoint does NOT synthesize HEAD from GET (unlike a
// +page route, which the old /route/[id] was), so without this a HEAD on a legacy
// URL would 405 instead of 301. Crawlers/monitors that HEAD the old path get the
// same permanent redirect.
export const HEAD: RequestHandler = GET;
