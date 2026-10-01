import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import type { Locale } from '$lib/i18n';

export async function getLabels(lang: Locale, ctx?: AdapterCtx): Promise<Record<string, string>> {
	return adapter.labels.get(lang, ctx);
}
