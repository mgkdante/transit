export const OTP_DOMAIN = [0, 100] as const;
export const SEVERE_DOMAIN = [0, 100] as const;
export const BUNCHED_DOMAIN = [0, 100] as const;
export const CANCEL_RATE_DOMAIN = [0, 100] as const;
export const SKIPPED_RATE_DOMAIN = [0, 100] as const;
export const SHARE_DOMAIN = [0, 100] as const;

export const DELAY_STOP_DOMAIN = [-2, 8] as const;
export const DELAY_POS_DOMAIN = [0, 8] as const;
export const DELAY_DIST_DOMAIN = [0, 15] as const;
export const DELAY_DOW_DOMAIN = [0, 8] as const;
export const HEADWAY_DOMAIN = [0, 35] as const;

export const COV_DOMAIN = [0, 1.5] as const;

export const HABITS_DOMAIN = [0, 1] as const;

export const DELAY_HISTOGRAM_DOMAIN = [-300, 1800] as const;

export const NETWORK_DELAY_HISTOGRAM_DOMAIN = DELAY_HISTOGRAM_DOMAIN;

export const OTP_TREND_MIN_SPAN = 8 as const;
export const OTP_TREND_REFERENCE = 80 as const;

export function otpTrendDomain(values: ReadonlyArray<number | null>): [number, number] {
	const OTP_TREND_PAD = 2;
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		if (v == null || Number.isNaN(v)) continue;
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 100];
	lo = Math.min(lo, OTP_TREND_REFERENCE);
	hi = Math.max(hi, OTP_TREND_REFERENCE);
	let min = Math.max(0, Math.floor(lo - OTP_TREND_PAD));
	let max = Math.min(100, Math.ceil(hi + OTP_TREND_PAD));
	if (max - min < OTP_TREND_MIN_SPAN) {
		const grow = (OTP_TREND_MIN_SPAN - (max - min)) / 2;
		min = Math.max(0, Math.floor(min - grow));
		max = Math.min(100, Math.ceil(max + grow));
		if (max - min < OTP_TREND_MIN_SPAN) {
			if (min === 0) max = Math.min(100, OTP_TREND_MIN_SPAN);
			else if (max === 100) min = Math.max(0, 100 - OTP_TREND_MIN_SPAN);
		}
	}
	return [min, max];
}
