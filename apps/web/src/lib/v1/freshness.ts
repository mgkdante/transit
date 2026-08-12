// v1 freshness — turn a tier's manifest pointer into a published/age/stale verdict.
//
// Each tier in the manifest carries `generated_utc` (the DATA time of the
// current build) and `ttl_s` (the publish cadence). Freshness is derived, never
// hardcoded:
//   - ageSeconds   = now - generated_utc (seconds).
//   - isStale      = age >= the staleness threshold, where the threshold is
//                    2x the tier's EFFECTIVE ttl (one missed publish window is
//                    tolerated; two means the feed is behind). This scales with
//                    the tier — ~60s for live (ttl 30), ~2 days for static/
//                    historic (ttl 86400) — so it is NEVER a literal 30s.
//
// The live tier always publishes (generated_utc is required). Static/historic
// may have a null generated_utc — that means the tier was NEVER published, which
// is reported as { published: false } (an empty-state signal, not staleness).

import { ageSeconds, formatRelativeSeconds, type TimeLang } from '$lib/utils/time';
import type { Manifest } from '$lib/v1/schemas';

/** Which snapshot tier to evaluate. */
export type FreshnessTier = 'live' | 'static' | 'historic';

/**
 * THE single server-anchored age derivation. Every freshness readout in the app
 * (the live store, FreshnessStamp, /status, the chrome chip) computes "how old is
 * this build" through THIS one function so the math is identical everywhere and
 * never re-implemented per surface.
 *
 * `generatedUtc` is a SERVER timestamp, so the age is anchored to the
 * caller's server-corrected `nowMs` — NOT an app-store import — so a skewed client
 * cannot mis-report it. Reactive callers should pass their shared ticking clock.
 * Returns null for a null/invalid stamp (the honest "no age"),
 * clamped to >= 0 so a build stamped slightly in the future reads as 0, not
 * negative.
 */
export function freshnessAgeSeconds(
	generatedUtc: string | null | undefined,
	nowMs: number,
): number | null {
	if (!generatedUtc) return null;
	const age = ageSeconds(generatedUtc, nowMs);
	return Number.isNaN(age) ? null : Math.max(0, age);
}

/**
 * Localized "N ago" text for a server-stamped build timestamp, off the SAME
 * server-anchored, shared-tick age as `freshnessAgeSeconds`. Returns null for a
 * null/invalid stamp so callers render their own honest "no data" rather than a
 * fabricated value.
 */
export function freshnessRelative(
	generatedUtc: string | null | undefined,
	lang: TimeLang,
	nowMs: number,
): string | null {
	const age = freshnessAgeSeconds(generatedUtc, nowMs);
	return age == null ? null : formatRelativeSeconds(age, lang);
}

/** A tier that has published at least once: full freshness verdict. */
export interface PublishedFreshness {
	readonly published: true;
	/** DATA time of the current build (ISO 8601, UTC). */
	readonly generatedUtc: string;
	/** Seconds since `generatedUtc` (>= 0; clamped — future builds read as 0). */
	readonly ageSeconds: number;
	/** True once age >= 2x the tier's effective ttl. */
	readonly isStale: boolean;
}

/** A tier that has never published (static/historic with null generated_utc). */
export interface UnpublishedFreshness {
	readonly published: false;
}

export type Freshness = PublishedFreshness | UnpublishedFreshness;

/** Schema defaults for ttl_s, mirrored so a manifest omitting them still scales. */
const DEFAULT_TTL_S: Record<FreshnessTier, number> = {
	live: 30,
	static: 86400,
	historic: 86400,
};

/** Multiplier: a tier is stale once it has missed TWO publish windows. */
const STALE_TTL_MULTIPLIER = 2;

/** Read a tier's generated_utc + ttl_s out of the manifest. */
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

/**
 * Freshness verdict for one tier.
 *
 * `now` is injectable for deterministic tests. A null generated_utc (only
 * possible for static/historic) returns { published: false }. Otherwise the age
 * is computed against `now` and compared to the derived 2x-ttl threshold.
 */
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
	// Invalid timestamp -> treat as never published rather than NaN-stale.
	if (Number.isNaN(rawAge)) {
		return { published: false };
	}

	// Clamp negatives: a build stamped slightly in the future (clock skew) is
	// "0 seconds old", not negative.
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
