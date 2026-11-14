import type { NetworkPointView as TrendPoint } from '#lib/v1/reliabilityView.ts';
export function selectDailyChange(
	series: readonly TrendPoint[],
	presentation?: {
		format: (n: number) => string;
		chip: (value: string, singular: boolean) => string;
	},
) {
	const latest = series.at(-1);
	const prior = series.at(-2);
	if (latest?.onTimePct == null || prior?.onTimePct == null) return null;
	const points = latest.onTimePct - prior.onTimePct;
	return {
		points,
		latest,
		prior,
		text: presentation?.chip(presentation.format(points), Math.abs(points) === 1) ?? null,
		color:
			points === 0
				? 'var(--muted-foreground)'
				: points > 0
					? 'var(--dataviz-status-on-time)'
					: 'var(--dataviz-status-late)',
	};
}
