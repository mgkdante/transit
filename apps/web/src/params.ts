import { defineParams } from '@sveltejs/kit/params';
import { PREFIX_LOCALES } from './lib/i18n/config.ts';

export const params = defineParams({
	locale: (value) => PREFIX_LOCALES.find((locale) => locale === value),
});
