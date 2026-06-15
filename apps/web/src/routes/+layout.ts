import type { LayoutLoad } from './$types';
import { pathLocale } from '$lib/i18n';
import { bootV1, type V1Context } from '$lib/v1';

// Universal layout load (runs SSR + client). Two jobs:
//
//   1. LOCALE. The active request locale is derived from the URL path prefix
//      (pathLocale: '/fr/*' → 'fr', everything else → the default 'en'). This
//      mirrors the path-derived <html lang> set in hooks.server.ts, so the lang
//      the layout renders with always matches the lang attribute the CDN cached.
//      It lands in `$page.data.lang` for every descendant.
//
//   2. V1 SNAPSHOT CONTEXT. In production the server layout (+layout.server.ts)
//      boots the contract over the `DATA` service binding and hands it here as
//      `data.v1` — we pass it straight through, so SSR ships real data in the
//      first paint with NO extra fetch and NO /v1-unreachable flash.
//
//      When the server did NOT supply a context (local `vite dev`/`preview`, or
//      a failed binding boot) we boot here over the universal `fetch`:
//        · dev      → the vite proxy serves /data, so this leg succeeds.
//        · prod     → a Worker's fetch to its OWN zone bypasses the sibling /data
//                     route (523); we fail soft to `v1Error` and +layout.svelte
//                     re-boots client-side (the browser reaches /data fine).
//
//      FAIL-SOFT: a manifest that is 404/unreachable MUST NOT crash the app —
//      the honesty doctrine is to render the `error-v1` edge state, not a white
//      screen. On failure we return `v1: null` and the layout swaps in the error
//      edge state instead of the page tree (so no descendant ever calls
//      getV1Context() without a provider).
export const load: LayoutLoad = async ({ url, fetch, data }) => {
	const lang = pathLocale(url.pathname);

	// Production happy path: the server already booted the contract through the
	// DATA binding. Pass it through verbatim — real data, no client round-trip.
	if (data?.v1) {
		return { lang, v1: data.v1, v1Error: false };
	}

	// No server context: dev (vite proxy serves /data) or a failed binding boot.
	let v1: V1Context | null = null;
	let v1Error = false;
	try {
		// Thread the load `fetch` so SSR resolves the same-origin `/data/v1` base
		// against the request origin (the Worker global fetch rejects relative URLs).
		v1 = await bootV1(lang, { fetch });
	} catch {
		// On Cloudflare this leg 523s (own-zone fetch); we fail soft and RE-BOOT
		// client-side in +layout.svelte. In dev the vite proxy makes it succeed.
		v1Error = true;
	}

	return { lang, v1, v1Error };
};
