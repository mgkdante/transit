import type { Handle } from '@sveltejs/kit';
import { pathLocale } from '$lib/i18n';

// Server hooks — the request-time plumbing for the transit web app.
//
// Two jobs, both per-request and CDN-safe (adapted from yesid.dev slice-28.6):
//
//   1. i18n <html lang>. app.html ships `<html lang="%lang%">`; the locale is
//      PATH-DERIVED (pathLocale), so every URL is exactly one cacheable
//      representation. We deliberately set NO `Vary` header — the lang is a
//      function of the path, never of a request header, so a CDN can cache the
//      EN and FR variants independently by URL. Error renders (which carry no
//      route params) still get the right lang because the path always does.
//
//   2. Per-request /v1 fetch memo. `event.locals.v1Cache` is a fresh Map per
//      HTTP request: the manifest + labels (and any other /v1 read that opts in)
//      are fetched once per SSR request and reused across loaders within that
//      request, then discarded. One Map per request = no cross-request leakage.
//      Typed as `App.Locals.v1Cache` in src/app.d.ts.

export const handle: Handle = async ({ event, resolve }) => {
	// Per-request /v1 fetch memo — discarded when the request ends.
	event.locals.v1Cache = new Map();

	// Path-derived locale → <html lang>. No Vary header: the representation is a
	// pure function of the URL path, so each URL is independently cacheable.
	const lang = pathLocale(event.url.pathname);

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', lang),
	});
};
