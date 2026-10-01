import type { ParamMatcher } from '@sveltejs/kit';
import { isPrefixLocale } from '../lib/i18n/routing';

export const match: ParamMatcher = (value): boolean => isPrefixLocale(value);
