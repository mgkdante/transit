import type { LineName } from '../site/lineDirectory';
import type { Locale } from '../i18n/config';

const STOP_TITLE_WORD = { en: 'stop', fr: 'arrêt' };
export function linePageTitle(name: LineName): string {
	return name.spoken;
}
export function stopPageTitle(
	name: string,
	code: string | null | undefined,
	locale: Locale,
): string {
	return code?.trim() ? name + ' (' + STOP_TITLE_WORD[locale] + ' ' + code.trim() + ')' : name;
}
