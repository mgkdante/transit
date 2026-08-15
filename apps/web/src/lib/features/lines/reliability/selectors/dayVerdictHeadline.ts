import type { ReliabilityPeriod, RouteReliability } from '$lib/v1';
import type { VerdictHeadline } from '$lib/v1/verdict';

const num = (value: number | null | undefined): number | null => value ?? null;

export function selectHeadlinePeriod(
	periods: readonly ReliabilityPeriod[],
	grain: string,
	selectedDate?: string,
): ReliabilityPeriod | null {
	if (periods.length === 0) return null;
	const matches = periods.filter((period) => period.grain === grain);
	if (matches.length === 0) return periods[0];
	if (selectedDate) {
		const exact = matches.find((period) => period.date === selectedDate);
		if (exact) return exact;
	}
	return matches.reduce((best, period) => {
		if (period.date == null) return best.date == null ? period : best;
		if (best.date == null) return period;
		return period.date >= best.date ? period : best;
	}, matches[0]);
}

export function selectDayVerdictHeadline(data: RouteReliability): VerdictHeadline {
	const periods = data.periods ?? [];
	const calendarPeriods = [
		...periods.filter((period) => period.grain === 'day'),
		...periods.filter((period) => period.grain === 'week'),
		...periods.filter((period) => period.grain === 'month'),
	];
	const period = selectHeadlinePeriod(calendarPeriods, 'day');

	return {
		otpPct: period ? num(period.otp_pct) : null,
		observationCount: period ? num(period.observation_count) : null,
		onTime: period ? num(period.on_time) : null,
	};
}
