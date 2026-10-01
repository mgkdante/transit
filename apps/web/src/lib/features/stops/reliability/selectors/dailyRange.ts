import { wilsonBoundsProportion, MIN_N_RATE } from '$lib/v1/stats';
import type { StopDailyPoint } from '$lib/v1';
import type { DateWindow } from '$lib/filters';
import { roundHalfAwayFromZero } from '$lib/utils';

export interface DailyRangeVerdict {
	readonly daysWithData: number;
	readonly from: string | null;
	readonly to: string | null;
	readonly observations: number;
	readonly severeCount: number;
	readonly severePct: number | null;
	readonly wilsonLo: number | null;
	readonly wilsonHi: number | null;
	readonly avgDelayMin: number | null;
	readonly reliable: boolean;
}

export interface ExactDailyRangeIngredients {
	readonly daysWithData: number;
	readonly from: string;
	readonly to: string;
	readonly observationCount: number;
	readonly inClampObservationCount: number;
	readonly severeCount: number;
	readonly sumDelaySeconds: number;
}

export function poolDailyRange(
	daily: readonly StopDailyPoint[] | null | undefined,
	window?: DateWindow | null,
	exact?: ExactDailyRangeIngredients | null,
): DailyRangeVerdict {
	if (exact != null && exact.daysWithData > 0 && exact.inClampObservationCount > 0) {
		const reliable = exact.inClampObservationCount >= MIN_N_RATE;
		const wilson = reliable
			? wilsonBoundsProportion(exact.severeCount, exact.inClampObservationCount)
			: null;
		return {
			daysWithData: exact.daysWithData,
			from: exact.from,
			to: exact.to,
			observations: exact.observationCount,
			severeCount: exact.severeCount,
			severePct: reliable
				? roundHalfAwayFromZero((100 * exact.severeCount) / exact.inClampObservationCount, 1)
				: null,
			wilsonLo: wilson ? roundHalfAwayFromZero(wilson[0] * 100, 1) : null,
			wilsonHi: wilson ? roundHalfAwayFromZero(wilson[1] * 100, 1) : null,
			avgDelayMin: roundHalfAwayFromZero(
				exact.sumDelaySeconds / exact.inClampObservationCount / 60,
				1,
			),
			reliable,
		};
	}

	const inRange = (daily ?? [])
		.filter((p) => (window ? p.date >= window.from && p.date <= window.to : true))
		.filter((p) => p.observation_count > 0)
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	if (inRange.length === 0) {
		return {
			daysWithData: 0,
			from: null,
			to: null,
			observations: 0,
			severeCount: 0,
			severePct: null,
			wilsonLo: null,
			wilsonHi: null,
			avgDelayMin: null,
			reliable: false,
		};
	}

	let observations = 0;
	let severeCount = 0;
	let avgWeightedSum = 0;
	let avgWeightN = 0;
	for (const p of inRange) {
		observations += p.observation_count;
		severeCount += p.severe_count;
		if (p.avg_delay_min != null) {
			avgWeightedSum += p.avg_delay_min * p.observation_count;
			avgWeightN += p.observation_count;
		}
	}

	const reliable = observations >= MIN_N_RATE;
	const severePct = reliable ? roundHalfAwayFromZero((100 * severeCount) / observations, 1) : null;
	const wilson = reliable ? wilsonBoundsProportion(severeCount, observations) : null;
	const avgDelayMin = avgWeightN > 0 ? roundHalfAwayFromZero(avgWeightedSum / avgWeightN, 1) : null;

	return {
		daysWithData: inRange.length,
		from: inRange[0].date,
		to: inRange[inRange.length - 1].date,
		observations,
		severeCount,
		severePct,
		wilsonLo: wilson ? roundHalfAwayFromZero(wilson[0] * 100, 1) : null,
		wilsonHi: wilson ? roundHalfAwayFromZero(wilson[1] * 100, 1) : null,
		avgDelayMin,
		reliable,
	};
}
