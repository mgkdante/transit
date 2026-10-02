import { ageSeconds, formatRelativeSeconds, type TimeLang } from '$lib/utils/time';
import type { Manifest } from '$lib/v1/schemas';

export type FreshnessTier = 'live' | 'static' | 'historic';

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

export interface PublishedFreshness {
	readonly published: true;
	readonly generatedUtc: string;
	readonly ageSeconds: number;
	readonly isStale: boolean;
}

export interface UnpublishedFreshness {
	readonly published: false;
}

export type Freshness = PublishedFreshness | UnpublishedFreshness;

const DEFAULT_TTL_S: Record<FreshnessTier, number> = {
	live: 30,
	static: 86400,
	historic: 86400,
};

const STALE_TTL_MULTIPLIER = 2;

function tierPointer(
	tier: FreshnessTier,
	manifest: Manifest,
): { generatedUtc: string | null; ttlS: number } {
	const files = manifest.files;
	const node = files[tier];
	const generatedUtc = node?.generated_utc ?? null;
	const ttlS = node?.ttl_s ?? DEFAULT_TTL_S[tier];
	return { generatedUtc, ttlS };
}

export function tierFreshness(
	tier: FreshnessTier,
	manifest: Manifest,
	now: Date = new Date(),
): Freshness {
	const { generatedUtc, ttlS } = tierPointer(tier, manifest);

	if (generatedUtc == null) {
		return { published: false };
	}

	const rawAge = ageSeconds(generatedUtc, now);
	if (Number.isNaN(rawAge)) {
		return { published: false };
	}

	const age = Math.max(0, rawAge);
	const staleThreshold = ttlS * STALE_TTL_MULTIPLIER;
	const isStale = age >= staleThreshold;

	return {
		published: true,
		generatedUtc,
		ageSeconds: age,
		isStale,
	};
}
