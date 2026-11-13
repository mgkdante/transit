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

/** Publish only complete spans backed by explicit dated counts in the fixture. */
export function withClosedPeriods(file: RouteReliability): RouteReliability {
	const days = [
		...new Map(
			(file.periods ?? []).filter((p) => p.grain === 'day' && p.date).map((p) => [p.date!, p]),
		).values(),
	].sort((a, b) => a.date!.localeCompare(b.date!));
	const end = days.at(-1)?.date;
	if (!end) return file;
	return {
		...file,
		periods_by_grain: [
			{ grain: 'day', date: end },
			...(['week', 'month'] as const).flatMap((grain) => {
				const size = grain === 'week' ? 7 : 30;
				const from = new Date(end + 'T00:00:00Z');
				from.setUTCDate(from.getUTCDate() - size + 1);
				const start = from.toISOString().slice(0, 10);
				const span = days.filter((p) => p.date! >= start);
				if (
					span.length !== size ||
					span.some((p) => p.observation_count == null || p.on_time == null)
				)
					return [];
				const by_daytype = ['weekday', 'weekend'].flatMap((type) => {
					const rows = span.filter(
						(p) =>
							[0, 6].includes(new Date(p.date! + 'T00:00:00Z').getUTCDay()) ===
							(type === 'weekend'),
					);
					if (!rows.length) return [];
					const observation_count = rows.reduce((n, p) => n + p.observation_count!, 0);
					const on_time = rows.reduce((n, p) => n + p.on_time!, 0);
					const weighted = (key: 'avg_delay_min' | 'severe_pct') =>
						observation_count > 0 && rows.every((p) => p[key] != null)
							? rows.reduce((n, p) => n + p[key]! * p.observation_count!, 0) / observation_count
							: null;
					return [
						{
							grain: type,
							observation_count,
							on_time,
							otp_pct: observation_count ? Math.round((100 * on_time) / observation_count) : null,
							avg_delay_min: weighted('avg_delay_min'),
							severe_pct: weighted('severe_pct'),
						},
					];
				});
				return [{ grain, date: start, by_daytype }];
			}),
		],
	};
}
export const juneClosedDays = [...Array(22).fill(67), 69, 70, 69, 69, 69, 69, 69, 82].map(
	(on_time: number, index) => ({
		grain: 'day',
		date: new Date(Date.UTC(2026, 4, 20 + index)).toISOString().slice(0, 10),
		observation_count: 100,
		on_time,
		otp_pct: on_time,
		avg_delay_min: 2.1,
		p50_min: 0.5,
		p90_min: 6,
		severe_pct: 3,
	}),
);
const header = (counts: readonly (readonly [number, number])[]) =>
	withClosedPeriods({
		id: '161',
		generated_utc: isoUtc().parse('2026-07-13T12:00:00Z'),
		periods: counts.map(([observation_count, on_time], i) => ({
			grain: 'day',
			date: '2026-07-' + String(6 + i).padStart(2, '0'),
			observation_count,
			on_time,
			otp_pct: observation_count ? Math.round((100 * on_time) / observation_count) : null,
		})),
	});
export const headerWeek = header([
	[15, 12],
	[15, 12],
	[15, 12],
	[15, 12],
	[15, 12],
	[15, 12],
	[10, 8],
]);
export const thinHeaderWeek = header([
	[1, 1],
	[1, 1],
	[1, 1],
	[1, 1],
	[1, 1],
	[1, 1],
	[4, 2],
]);

export const historyWeek = header([
	[0, 0],
	[0, 0],
	[0, 0],
	[0, 0],
	[0, 0],
	[0, 0],
	[100, 12],
]);
