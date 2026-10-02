import type { StatusCode } from './schemas';

export const OTP_ON_TIME_FLOOR = 90;
export const OTP_LATE_FLOOR = 75;

export function otpVerdict(otpPct: number | null | undefined): StatusCode | null {
	if (otpPct == null || Number.isNaN(otpPct)) return null;
	if (otpPct >= OTP_ON_TIME_FLOOR) return 'on_time';
	if (otpPct >= OTP_LATE_FLOOR) return 'late';
	return 'severe';
}

export const PROBLEM_VERDICTS: readonly StatusCode[] = ['late', 'severe'];

export function isProblemVerdict(verdict: StatusCode | null): boolean {
	return verdict != null && PROBLEM_VERDICTS.includes(verdict);
}
