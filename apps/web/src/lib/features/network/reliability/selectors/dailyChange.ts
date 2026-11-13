import type { TrendPoint } from '#lib/v1/index.ts';
export function selectDailyChange(
	series: readonly TrendPoint[],
	presentation?: {
		format: (n: number) => string;
		chip: (value: string, singular: boolean) => string;
	},
) {
	const latest = series.at(-1);
	const prior = series.at(-2);
	if (latest?.otp_pct == null || prior?.otp_pct == null) return null;
	const points = latest.otp_pct - prior.otp_pct;
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
