import type { RouteReliability } from '#lib/v1/index.ts';
import { isoUtc } from '#lib/v1/schemas/types.ts';

export const closedWeek: RouteReliability = {
	id: 'invented-line',
	generated_utc: isoUtc().parse('2026-11-11T00:00:00Z'),
	periods: [
		{ grain: 'day', date: '2026-11-10', otp_pct: 85, observation_count: 43815, on_time: 37243 },
		{ grain: 'day', date: '2026-11-11', otp_pct: 75, observation_count: 1191, on_time: 893 },
	],
	periods_by_grain: [
		{ grain: 'day', date: '2026-11-10' },
		{
			grain: 'week',
			date: '2026-11-04',
			by_daytype: [
				{
					grain: 'weekday',
					observation_count: 200000,
					on_time: 170000,
					avg_delay_min: 2,
					severe_pct: 10,
				},
				{
					grain: 'weekend',
					observation_count: 27378,
					on_time: 20827,
					avg_delay_min: 4,
					severe_pct: 20,
				},
			],
		},
	],
};

/** Mark the legacy selector fixtures' supplied periods as published closed windows. */
export function withClosedPeriods(file: RouteReliability): RouteReliability {
	const periods =
		file.periods?.map((p) => (p.grain === 'day' ? { ...p, date: p.date ?? '2026-06-18' } : p)) ??
		[];
	const date =
		periods
			.filter((p) => p.grain === 'day')
			.map((p) => p.date!)
			.sort()
			.at(-1) ?? '2026-06-18';
	return {
		...file,
		periods,
		periods_by_grain: [
			{ grain: 'day', date },
			...(['week', 'month'] as const).flatMap((grain) => {
				const period =
					periods.filter((p) => p.grain === grain).at(-1) ??
					(grain === 'week' ? periods.find((p) => p.grain === 'day') : undefined);
				if (!period) return [];
				const n = period.observation_count ?? 10000;
				const from = new Date(`${date}T00:00:00Z`);
				from.setUTCDate(from.getUTCDate() - (grain === 'week' ? 6 : 29));
				return [
					{
						grain,
						date: from.toISOString().slice(0, 10),
						by_daytype: [
							{
								...period,
								grain: 'weekday',
								observation_count: n,
								on_time: period.on_time ?? Math.round((n * (period.otp_pct ?? 0)) / 100),
							},
						],
					},
				];
			}),
		],
	};
}
