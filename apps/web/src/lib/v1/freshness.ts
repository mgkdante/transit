import { ageSeconds, formatRelativeSeconds, type TimeLang } from '#lib/utils/time.ts';

export const DEFAULT_LIVE_TTL_S = 30;

export function freshnessAgeSeconds(
	generatedUtc: string | null | undefined,
	nowMs: number,
	futureToleranceS: number = DEFAULT_LIVE_TTL_S,
): number | null {
	if (!generatedUtc) return null;
	const age = ageSeconds(generatedUtc, nowMs);
	if (!Number.isFinite(age) || !Number.isFinite(futureToleranceS)) return null;
	// Check raw milliseconds before rounding so the tolerance has an exact boundary.
	if (Date.parse(generatedUtc) - nowMs > Math.max(0, futureToleranceS) * 1000) return null;
	return Math.max(0, age);
}

export function freshnessRelative(
	generatedUtc: string | null | undefined,
	lang: TimeLang,
	nowMs: number,
): string | null {
	const age = freshnessAgeSeconds(generatedUtc, nowMs);
	return age == null ? null : formatRelativeSeconds(age, lang);
}
