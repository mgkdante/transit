import type {
	RouteReliability,
	StopReliability,
	TrendPoint,
	HistoricAvailabilityIndex,
} from './index';
export interface ClosedWindow {
	readonly from: string;
	readonly to: string;
	readonly days: number;
}
type RouteWindows = Pick<RouteReliability, 'periods_by_grain'>;
export function routeClosedThrough(file: RouteWindows): string | null {
	return file.periods_by_grain?.find((row) => row.grain === 'day')?.date ?? null;
}
export function stopClosedThrough(file: Pick<StopReliability, 'daily'>): string | null {
	return (
		file.daily
			?.map((row) => row.date)
			.sort()
			.at(-1) ?? null
	);
}
export function recordClosedThrough(index: HistoricAvailabilityIndex | null): string | null {
	for (const family of ['network', 'lines', 'hotspots']) {
		const date = index?.families?.find((row) => row.family === family)?.last_available_date;
		if (date) return date;
	}
	return null;
}
export function isClosedDay(date: string, closedThrough: string | null): boolean {
	return closedThrough != null && date <= closedThrough;
}
export function trailingRouteWindow(file: RouteWindows, grain: 'week' | 'month') {
	const to = routeClosedThrough(file);
	const row = file.periods_by_grain?.find((row) => row.grain === grain);
	const rows = row?.by_daytype;
	const days = to && row?.date ? (Date.parse(to) - Date.parse(row.date)) / 86400000 + 1 : null;
	if (
		!to ||
		!row?.date ||
		row.date > to ||
		days !== (grain === 'week' ? 7 : 30) ||
		!rows?.length ||
		rows.some((r) => r.observation_count == null || r.on_time == null)
	)
		return null;
	const observationCount = rows.reduce((n, r) => n + r.observation_count!, 0);
	const weighted = (key: 'avg_delay_min' | 'severe_pct') =>
		observationCount > 0 && rows.every((r) => r.observation_count === 0 || r[key] != null)
			? rows.reduce((sum, r) => sum + (r[key] ?? 0) * r.observation_count!, 0) / observationCount
			: null;
	return {
		window: { from: row.date, to, days } satisfies ClosedWindow,
		observationCount,
		onTime: rows.reduce((n, r) => n + r.on_time!, 0),
		avgDelayMin: weighted('avg_delay_min'),
		severePct: weighted('severe_pct'),
	};
}
export function closedTrendPoints(
	points: readonly TrendPoint[],
	grain: 'day' | 'week' | 'month',
	closedThrough: string | null,
): readonly TrendPoint[] {
	return points.filter((point) => {
		const end = new Date(`${point.date}T00:00:00Z`);
		if (grain === 'week') end.setUTCDate(end.getUTCDate() + 6);
		if (grain === 'month') end.setUTCMonth(end.getUTCMonth() + 1, 0);
		return isClosedDay(end.toISOString().slice(0, 10), closedThrough);
	});
}

export function trendClosedThrough(
	index: HistoricAvailabilityIndex | null,
	series: readonly TrendPoint[],
): string | null {
	const anchor = recordClosedThrough(index);
	if (anchor) return anchor;
	const newest = series
		.map((p) => p.date)
		.sort()
		.at(-1);
	if (!newest) return null;
	const day = new Date(newest + 'T00:00:00Z');
	day.setUTCDate(day.getUTCDate() - 1);
	return day.toISOString().slice(0, 10);
}
