import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { DEFAULT_LOCALE, type Locale } from '#lib/i18n/index.ts';
import { bootProvider } from '#lib/v1/boot.ts';
import { serverV1Context } from '#lib/v1/serverContext.ts';
import { getRoutesIndex } from '#lib/v1/repositories/static.ts';

export const load: LayoutServerLoad = async (event) => {
	const { params, locals } = event;
	const lang = (params.lang as Locale | undefined) ?? locals.locale ?? DEFAULT_LOCALE;

	const selection = await bootProvider(
		event.url,
		lang,
		serverV1Context(event),
		locals.approximateLocation,
	);
	if (selection.redirectHref) redirect(307, selection.redirectHref);
	if (selection.discoveryError) event.setHeaders({ 'cache-control': 'no-store' });
	const routesIndex = selection.v1
		? await getRoutesIndex({
				...serverV1Context(event),
				manifest: selection.v1.manifest,
				providerId: selection.providerId,
			}).catch(() => null)
		: null;
	return {
		routesIndex,
		lang,
		...selection,
		serverBoot: selection.v1 ? ('succeeded' as const) : ('failed' as const),
	};
};
