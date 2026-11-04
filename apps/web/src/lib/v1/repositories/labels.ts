import { adapter, type AdapterCtx } from '#lib/v1/adapter/index.ts';
import type { Locale } from '#lib/i18n/index.ts';

export const getLabels: (lang: Locale, ctx?: AdapterCtx) => Promise<Record<string, string>> = (
	lang,
	ctx,
) => adapter.labels.get(lang, ctx);
