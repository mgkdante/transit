import type { LayoutLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { DEFAULT_LOCALE } from '$lib/i18n';

export const load: LayoutLoad = ({ data }) => {
	const lang = data?.lang ?? DEFAULT_LOCALE;
	if (data.redirectHref) redirect(307, data.redirectHref);
	return { ...data, lang, v1Error: !data.v1 };
};
