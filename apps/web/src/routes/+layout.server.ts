import type { LayoutServerLoad } from './$types';
import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';
import { bootV1, type V1Context } from '$lib/v1';
import { serverV1Context } from '$lib/v1/serverContext';

// Server layout load — boots the /v1 snapshot contract through the direct R2
// binding so the first paint ships real data without consuming data-proxy Worker
// requests. DATA remains a compatibility fallback.
//
// FAIL-SOFT, two ways:
//   · no binding (local `vite dev` / `vite preview`) → return `v1: null` and let
//     the UNIVERSAL +layout.ts boot over the load `fetch` (the vite proxy serves
//     /data in dev).
//   · binding present but the boot throws (R2 / contract gap) →
//     also return `v1: null`; +layout.ts fails soft to `v1Error` and
//     +layout.svelte re-boots client-side (the browser reaches /data fine).
//
// The returned `v1` is plain JSON (manifest + labels + lang), so it serializes
// into the SSR payload and rehydrates without a client round-trip.
export const load: LayoutServerLoad = async (event) => {
	const { params, platform, locals } = event;
	// [[lang=locale]] has already passed the locale matcher. Reading only this
	// param lets SvelteKit retain the root layout across same-locale navigation.
	// Error renders have no matched params, so the request hook supplies the same
	// path locale it uses for <html lang> without making this load track the URL.
	const lang = (params.lang as Locale | undefined) ?? locals.locale ?? DEFAULT_LOCALE;
	const binding = platform?.env?.SNAPSHOTS ?? platform?.env?.DATA;

	if (!binding) {
		// Local dev / preview: no service binding. Defer the boot to +layout.ts.
		return { lang, v1: null as V1Context | null, serverBoot: 'skipped' as const };
	}

	try {
		// Reuse the request-scoped fetch + memo installed by hooks.server. Descendant
		// loaders now share this manifest read instead of opening a second boot lane.
		const v1 = await bootV1(lang, serverV1Context(event));
		return { lang, v1, serverBoot: 'succeeded' as const };
	} catch {
		// Binding present but unreachable — let the client recover (+layout.svelte).
		return { lang, v1: null as V1Context | null, serverBoot: 'failed' as const };
	}
};
