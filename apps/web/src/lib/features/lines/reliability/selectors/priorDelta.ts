import { roundHalfAwayFromZero } from '$lib/utils/rounding';

/** Descriptive difference between the same metric in adjacent windows; null means unavailable. */
export function priorDelta(
	value: number | null | undefined,
	priorValue: number | null | undefined,
	digits = 0,
): number | null {
	const delta = value == null || priorValue == null ? NaN : value - priorValue;
	return Number.isFinite(delta) ? roundHalfAwayFromZero(delta, digits) : null;
}
