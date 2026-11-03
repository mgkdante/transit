import { ageSeconds, formatRelativeSeconds, type TimeLang } from '$lib/utils/time';

export function freshnessAgeSeconds(
	generatedUtc: string | null | undefined,
	nowMs: number,
): number | null {
	if (!generatedUtc) return null;
	const age = ageSeconds(generatedUtc, nowMs);
	return Number.isNaN(age) ? null : Math.max(0, age);
}

export function freshnessRelative(
	generatedUtc: string | null | undefined,
	lang: TimeLang,
	nowMs: number,
): string | null {
	const age = freshnessAgeSeconds(generatedUtc, nowMs);
	return age == null ? null : formatRelativeSeconds(age, lang);
}
