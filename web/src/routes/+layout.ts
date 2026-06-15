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
//   2. V1 SNAPSHOT CONTEXT. bootV1(lang) fetches the snapshot manifest + the
//      per-language label table once and returns the ready V1Context the whole
//      app reads via getV1Context(). Booting in the UNIVERSAL load means SSR and
//      CSR share one boot, and the context object exists synchronously at layout
//      init (the layout calls setV1Context with it).
//
//      FAIL-SOFT: a manifest that is 404/unreachable MUST NOT crash the app —
//      the honesty doctrine is to render the `error-v1` edge state, not a white
//      screen. So boot is wrapped: on failure we return `v1: null` and the
//      layout swaps in the error edge state instead of the page tree (so no
//      descendant ever calls getV1Context() without a provider).
export const load: LayoutLoad = async ({ url }) => {
	const lang = pathLocale(url.pathname);

	let v1: V1Context | null = null;
	let v1Error = false;
	try {
		v1 = await bootV1(lang);
	} catch {
		v1Error = true;
	}

	return { lang, v1, v1Error };
};
