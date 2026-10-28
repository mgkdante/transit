import { createCopy, createIntl } from '@yesid/i18n-core';
import { INTL_TAGS, type Locale } from './config';

export type { Locale } from './config';

export const defineCopy = createCopy<Locale, 'fr'>();

export const intl = createIntl<Locale>(INTL_TAGS);
