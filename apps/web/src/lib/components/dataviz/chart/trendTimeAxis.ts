import type { Locale } from '$lib/i18n';
import { formatDateKey } from '$lib/utils/time';
import type { TrendDatum } from './ChartSpec';

export function trendTimeAxis(points: readonly TrendDatum[], locale: Locale) {
	const dated = new Map(
		points
			.filter((point) => Number.isFinite(Number(point.x)))
			.map((point) => [Number(point.x), point.xLabel] as const),
	);
	const positions = [...dated.keys()].sort((a, b) => a - b);
	const count = Math.min(4, positions.length);
	const end = positions.at(-1) ?? 0;
	const minimumGap = count > 1 ? (end - positions[0]) / (count - 1) : Infinity;
	const ticks: number[] = [];
	for (const position of positions) {
		if (
			ticks.length === 0 ||
			(position - ticks[ticks.length - 1] >= minimumGap && end - position >= minimumGap)
		)
			ticks.push(position);
	}
	if (positions.length > 1) ticks.push(end);
	const calendarLabels = [...dated.values()].filter((label) => /^\d{4}-\d{2}-\d{2}$/.test(label));
	const includeYear = new Set(calendarLabels.map((label) => label.slice(0, 4))).size > 1;

	return {
		domain: (positions.length ? [positions[0], end] : [0, 1]) as [number, number],
		ticks,
		format: (position: number) => {
			const label = dated.get(Number(position)) ?? '';
			return /^\d{4}-\d{2}-\d{2}$/.test(label) ? formatDateKey(label, locale, includeYear) : label;
		},
	};
}
