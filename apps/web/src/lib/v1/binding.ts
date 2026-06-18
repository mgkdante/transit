// SSR /v1 fetch over the Cloudflare service binding.
//
// On Cloudflare a Worker's fetch to its OWN zone (transit.yesid.dev/data/*)
// bypasses the sibling data-proxy route and hits a non-existent origin → 523, so
// server-side rendering cannot reach the snapshot contract over a same-origin
// URL. The `DATA` service binding (wrangler.toml → transit-data-proxy) invokes
// that Worker DIRECTLY, with no DNS/route hop. This module adapts the binding's
// `fetch` into the `FetchFn` shape the v1 adapter threads as `ctx.fetch`, so
// +layout.server.ts can boot the contract server-side and ship real data in the
// first paint (no /v1-unreachable flash).
//
// The v1 config builds SAME-ORIGIN RELATIVE paths (`/data/v1/stm/...`); a service
// binding needs an absolute URL, so we resolve relatives against the request
// origin. The data-proxy routes on `pathname` (it requires `/data/v1/…` and
// strips `/data/`), so the host segment is immaterial — only the path matters.

import type { FetchFn } from '$lib/v1/http';

/** The minimal shape of a Cloudflare service binding we depend on. */
export interface ServiceBinding {
	fetch: typeof fetch;
}

/**
 * Wrap a `DATA` service binding as a `FetchFn` that resolves the v1 adapter's
 * relative snapshot paths against `origin` before dispatching to the bound
 * Worker. Absolute inputs (and `Request`/`URL` inputs) pass straight through.
 *
 * @param binding the `platform.env.DATA` service binding.
 * @param origin  the request origin (`url.origin`) to resolve relative paths against.
 */
export function bindingFetch(binding: ServiceBinding, origin: string): FetchFn {
	const fn = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		// Only string inputs are relative (the adapter passes resolveUrl() strings).
		// Resolve them to absolute against the request origin; pass URL/Request through.
		const target = typeof input === 'string' ? new URL(input, origin) : input;
		return binding.fetch(target as Parameters<typeof fetch>[0], init);
	};
	return fn as FetchFn;
}
