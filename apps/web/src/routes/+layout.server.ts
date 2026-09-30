import type { LayoutServerLoad } from './$types';
import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';
import { bootV1, type V1Context } from '$lib/v1/boot';
import { serverV1Context } from '$lib/v1/serverContext';

// Boot through R2 (DATA is the compatibility fallback) and serialize the context
// for hydration. Missing bindings defer to the universal load; failed bindings
// defer recovery to the mounted browser.
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
