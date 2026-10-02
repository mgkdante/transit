import type { LayoutServerLoad } from './$types';
import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';
import { bootV1, type V1Context } from '$lib/v1/boot';
import { serverV1Context } from '$lib/v1/serverContext';

export const load: LayoutServerLoad = async (event) => {
	const { params, platform, locals } = event;
	const lang = (params.lang as Locale | undefined) ?? locals.locale ?? DEFAULT_LOCALE;
	const binding = platform?.env?.SNAPSHOTS ?? platform?.env?.DATA;

	if (!binding) {
		return { lang, v1: null as V1Context | null, serverBoot: 'skipped' as const };
	}

	try {
		const v1 = await bootV1(lang, serverV1Context(event));
		return { lang, v1, serverBoot: 'succeeded' as const };
	} catch {
		return { lang, v1: null as V1Context | null, serverBoot: 'failed' as const };
	}
};
