import type { LayoutLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { DEFAULT_LOCALE } from '$lib/i18n';
import { bootProvider } from '$lib/v1/boot';

export const load: LayoutLoad = async ({ fetch, data, url }) => {
	const lang = data?.lang ?? DEFAULT_LOCALE;
	const selection =
		data?.serverBoot === 'skipped' ? await bootProvider(url, lang, { fetch }) : data;
	if (selection.redirectHref) redirect(307, selection.redirectHref);
	return { ...selection, lang, v1Error: !selection.v1 };
};
