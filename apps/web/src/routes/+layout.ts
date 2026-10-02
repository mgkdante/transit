import type { LayoutLoad } from './$types';
import { DEFAULT_LOCALE } from '$lib/i18n';
import { bootV1, type V1Context } from '$lib/v1/boot';

export const load: LayoutLoad = async ({ fetch, data }) => {
	const lang = data?.lang ?? DEFAULT_LOCALE;

	if (data?.v1) {
		return { lang, v1: data.v1, v1Error: false };
	}

	if (data?.serverBoot === 'failed') {
		return { lang, v1: null as V1Context | null, v1Error: true };
	}

	let v1: V1Context | null = null;
	let v1Error = false;
	try {
		v1 = await bootV1(lang, { fetch });
	} catch {
		v1Error = true;
	}

	return { lang, v1, v1Error };
};
