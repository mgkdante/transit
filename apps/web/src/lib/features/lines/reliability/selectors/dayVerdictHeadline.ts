import type { RouteReliability } from '#lib/v1/index.ts';
import type { Locale } from '#lib/i18n/index.ts';
import { verdictForWindow } from '#lib/v1/verdict.ts';
export { selectHeadlinePeriod } from '#lib/v1/verdict.ts';
export function selectDayVerdictHeadline(data: RouteReliability, locale: Locale = 'en') {
	return verdictForWindow(data, { kind: 'route' }, locale);
}
