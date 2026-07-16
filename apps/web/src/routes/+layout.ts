import type { LayoutLoad } from './$types';
import { DEFAULT_LOCALE } from '$lib/i18n';
import { bootV1, type V1Context } from '$lib/v1';

// Universal layout load (runs SSR + client). Two jobs:
//
//   1. LOCALE. The active request locale is supplied by +layout.server.ts from
//      the validated [[lang=locale]] param. Avoiding url.pathname here lets
//      SvelteKit retain this root load across same-locale page navigation while
//      keeping the rendered locale aligned with the request path.
//
//   2. V1 SNAPSHOT CONTEXT. In production the server layout (+layout.server.ts)
//      boots the contract over the direct `SNAPSHOTS` binding (with `DATA` as a
//      compatibility fallback) and hands it here as
//      `data.v1` — we pass it straight through, so SSR ships real data in the
//      first paint with NO extra fetch and NO /v1-unreachable flash.
//
//      When the server did NOT supply a context (local `vite dev`/`preview`, or
//      a failed binding boot) we boot here over the universal `fetch`:
//        · dev      → the vite proxy serves /data, so this leg succeeds.
//        · prod     → the bound server path has already run; a failure is not
//                     retried here, and the mounted browser gets one recovery
//                     attempt against the public R2 custom domain.
//
//      FAIL-SOFT: a manifest that is 404/unreachable MUST NOT crash the app —
//      the honesty doctrine is to render the `error-v1` edge state, not a white
//      screen. On failure we return `v1: null` and the layout swaps in the error
//      edge state instead of the page tree (so no descendant ever calls
//      getV1Context() without a provider).
export const load: LayoutLoad = async ({ fetch, data }) => {
	const lang = data?.lang ?? DEFAULT_LOCALE;

	// Production happy path: the server already booted the contract through the
	// direct binding. Pass it through verbatim — real data, no client round-trip.
	if (data?.v1) {
		return { lang, v1: data.v1, v1Error: false };
	}

	// The bound server transport already made the authoritative attempt. Repeating
	// the same path from a universal SSR load only amplifies an outage; the mounted
	// browser gets one recovery attempt against the public R2 origin instead.
	if (data?.serverBoot === 'failed') {
		return { lang, v1: null as V1Context | null, v1Error: true };
	}

	// No server context: dev (vite proxy serves /data) or a failed binding boot.
	let v1: V1Context | null = null;
	let v1Error = false;
	try {
		// Thread the load fetch so local relative `/data/v1` paths use Vite's proxy.
		v1 = await bootV1(lang, { fetch });
	} catch {
		// Fail soft; the mounted client owns the single public-origin recovery.
		v1Error = true;
	}

	return { lang, v1, v1Error };
};
