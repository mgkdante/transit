import type { LayoutLoad } from './$types';
import { DEFAULT_LOCALE } from '$lib/i18n';
import { bootV1, type V1Context } from '$lib/v1/boot';

// Reuse the server locale/context without tracking the URL, allowing same-locale
// navigation to retain this load. A missing context renders the V1 error state;
// descendant loaders must never receive an absent provider.
export const load: LayoutLoad = async ({ fetch, data }) => {
	const lang = data?.lang ?? DEFAULT_LOCALE;

	if (data?.v1) {
		return { lang, v1: data.v1, v1Error: false };
	}

	// The bound server transport already made the authoritative attempt. Repeating
	// the same path from a universal SSR load only amplifies an outage; the mounted
	// browser gets one recovery attempt against the public R2 origin instead.
	if (data?.serverBoot === 'failed') {
		return { lang, v1: null as V1Context | null, v1Error: true };
	}

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
