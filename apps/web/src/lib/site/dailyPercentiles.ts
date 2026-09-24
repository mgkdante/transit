import type { Locale } from '$lib/i18n';
import { fmtCount, fmtDelayMin } from '$lib/utils';
import type { LineHistoryRange, StopHistoryRange } from '$lib/v1/history/families';

/** Only a selected, accepted day can supply an exact percentile difference. */
export function selectDailyPercentiles(
	range: Pick<LineHistoryRange | StopHistoryRange, 'window' | 'delayPercentiles'> | null,
) {
	if (range == null || range.window.from !== range.window.to) return null;
	const metric = range.delayPercentiles;
	const day = metric.value?.find((entry) => entry.date === range.window.from);
	if (day == null) return null;
	const { p50_delay_seconds: p50, p90_delay_seconds: p90, observation_count: n } = day.value;
	const spread =
		p50 != null && p90 != null && Number.isFinite(p50) && Number.isFinite(p90) && p90 >= p50
			? (p90 - p50) / 60
			: null;
	return {
		date: day.date,
		p50: p50 == null ? null : p50 / 60,
		p90: p90 == null ? null : p90 / 60,
		spreadMin: spread != null && Number.isFinite(spread) ? spread : null,
		observationCount: n,
		partial: metric.status === 'partial',
	};
}

export function dailyPercentileCaption(
	day: NonNullable<ReturnType<typeof selectDailyPercentiles>>,
	locale: Locale,
): string {
	const spread = fmtDelayMin(day.spreadMin, { rounding: 'fixed1', locale });
	const n = fmtCount(day.observationCount, { locale });
	const scope =
		locale === 'fr'
			? `${day.date} · ${n} prévisions de retard admissibles${day.partial ? ' · couverture partielle' : ''}.`
			: `${day.date} · ${n} eligible delay predictions${day.partial ? ' · partial coverage' : ''}.`;
	if (spread == null) return scope;
	return locale === 'fr'
		? `Écart p90 − médiane : ${spread}. ${scope}`
		: `p90 − median spread: ${spread}. ${scope}`;
}
