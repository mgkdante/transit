import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';
import { bootProvider } from '$lib/v1/boot';
import { serverV1Context } from '$lib/v1/serverContext';

export const load: LayoutServerLoad = async (event) => {
	const { params, locals } = event;
	const lang = (params.lang as Locale | undefined) ?? locals.locale ?? DEFAULT_LOCALE;

	const selection = await bootProvider(event.url, lang, serverV1Context(event));
	if (selection.redirectHref) redirect(307, selection.redirectHref);
	return {
		lang,
		...selection,
		serverBoot: selection.v1 ? ('succeeded' as const) : ('failed' as const),
	};
};
