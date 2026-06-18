import type { LayoutServerLoad } from './$types';
import { pathLocale } from '$lib/i18n';
import { bootV1, type V1Context } from '$lib/v1';
import { bindingFetch } from '$lib/v1/binding';

// Server layout load — boots the /v1 snapshot contract server-side over the
// `DATA` service binding so the first paint ships REAL data (no /v1-unreachable
// flash).
//
// WHY a binding and not a same-origin fetch: on Cloudflare a Worker's fetch to
// its OWN zone (transit.yesid.dev/data/*) bypasses the sibling data-proxy route
// and hits a non-existent origin → 523. The `DATA` binding (wrangler.toml →
// transit-data-proxy) calls that Worker directly, so the SSR boot succeeds.
//
// FAIL-SOFT, two ways:
//   · no binding (local `vite dev` / `vite preview`) → return `v1: null` and let
//     the UNIVERSAL +layout.ts boot over the load `fetch` (the vite proxy serves
//     /data in dev).
//   · binding present but the boot throws (data-proxy down / contract gap) →
//     also return `v1: null`; +layout.ts fails soft to `v1Error` and
//     +layout.svelte re-boots client-side (the browser reaches /data fine).
//
// The returned `v1` is plain JSON (manifest + labels + lang), so it serializes
// into the SSR payload and rehydrates without a client round-trip.
export const load: LayoutServerLoad = async ({ url, platform }) => {
	const lang = pathLocale(url.pathname);
	const binding = platform?.env?.DATA;

	if (!binding) {
		// Local dev / preview: no service binding. Defer the boot to +layout.ts.
		return { lang, v1: null as V1Context | null };
	}

	try {
		const v1 = await bootV1(lang, { fetch: bindingFetch(binding, url.origin) });
		return { lang, v1 };
	} catch {
		// Binding present but unreachable — let the client recover (+layout.svelte).
		return { lang, v1: null as V1Context | null };
	}
};
