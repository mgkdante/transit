// map/vehicleSilence.ts — the HONESTY half of the kinetic map: per-vehicle
// "stop + fade on silence".
//
// The position TWEEN (vehicleMotion.ts) already animates a bus ONLY between two
// real reported positions and clamps to [0,1] (never extrapolates past the last
// real fix). What it cannot express is the OTHER honest signal: a single bus can
// go quiet while the rest of the feed stays fresh. The global stale-dim
// (vehicleLayer.setStale) only fires when the WHOLE live tier is behind; it says
// nothing about one bus that stopped reporting.
//
// This module computes, per vehicle, how long since ITS OWN last report and maps
// that to an icon opacity. A bus that just reported is full strength; one whose
// last fix is getting old fades toward a low-but-still-visible floor. We never
// hard-remove it — the feed still lists it, so honestly it is "last seen N ago",
// shown dimmed, not deleted. And we never brighten a stale bus: dim is
// monotonic in staleness.
//
// Thresholds are derived from the live tier's ttl (manifest live ttl, default
// 30s) so they track the publisher's cadence rather than a magic number:
//   · below FRESH_TTL_MULTIPLIER × ttl   → full opacity (a normal report gap)
//   · between FRESH and SILENT windows   → fade LINEARLY down to the floor
//   · at/after SILENT_TTL_MULTIPLIER×ttl → pinned at SILENCE_FLOOR_OPACITY
// Rationale for the multipliers: one whole missed publish window (~1×ttl) is
// normal jitter and must NOT dim. We give it a little more headroom (1.5×) before
// the fade starts, then fade across another ~1.5 windows, reaching the floor at
// 3×ttl — the same "two missed windows = behind" spirit as the global stale
// threshold (2×ttl), just softened into a gradient and pushed out slightly so a
// merely-late bus is not punished alongside a truly silent one.

/** Fade starts once a vehicle's own report is older than this × ttl. */
export const FRESH_TTL_MULTIPLIER = 1.5;
/** Fade reaches the floor once the report is this × ttl old. */
export const SILENT_TTL_MULTIPLIER = 3;
/**
 * Floor opacity for a long-silent bus that is STILL in the feed. Low enough to
 * read as "stale / last seen a while ago", high enough to stay visible (we are
 * honest that it is still listed, we do not erase it).
 */
export const SILENCE_FLOOR_OPACITY = 0.25;

/** Default live ttl (seconds) when the manifest omits it — mirrors the schema. */
export const DEFAULT_LIVE_TTL_S = 30;

/**
 * Seconds since a vehicle's OWN last report, on the server's timeline.
 *
 * `serverNow` MUST be `sharedClock.serverNow` (skew-corrected) so the age is
 * immune to a wrong client clock — both operands then sit on the server's
 * timeline, exactly like the freshness badge. Clamped to >= 0 (a report stamped
 * slightly in the future from skew reads as "0s ago", never negative). A missing
 * or unparseable `updated_utc` is treated as maximally silent (returns
 * Infinity), so it floors rather than masquerading as fresh.
 */
export function silenceAgeS(updatedUtc: string | null | undefined, serverNow: number): number {
	if (updatedUtc == null) return Number.POSITIVE_INFINITY;
	const reportedMs = Date.parse(updatedUtc);
	if (Number.isNaN(reportedMs)) return Number.POSITIVE_INFINITY;
	return Math.max(0, (serverNow - reportedMs) / 1000);
}

/**
 * Per-vehicle icon opacity from its silence age, in [SILENCE_FLOOR_OPACITY, 1].
 *
 * Continuous + monotonic non-increasing in `ageS`: full strength up to the fresh
 * window, a straight linear ramp through the fade window, then pinned at the
 * floor. `ttlS` is clamped to a sane minimum so a degenerate manifest can't
 * collapse the windows.
 */
export function silenceOpacity(ageS: number, ttlS: number = DEFAULT_LIVE_TTL_S): number {
	const ttl = Math.max(1, ttlS);
	const fadeStart = FRESH_TTL_MULTIPLIER * ttl;
	const fadeEnd = SILENT_TTL_MULTIPLIER * ttl;
	if (ageS <= fadeStart) return 1;
	if (ageS >= fadeEnd) return SILENCE_FLOOR_OPACITY;
	const progress = (ageS - fadeStart) / (fadeEnd - fadeStart);
	return 1 - progress * (1 - SILENCE_FLOOR_OPACITY);
}

/**
 * Helper predicate: true once a vehicle is past the fade window
 * (>= SILENT_TTL_MULTIPLIER × ttl), i.e. fully silent and pinned at the floor.
 *
 * This does NOT drive the in-place "stop gliding" guarantee — that already
 * follows mechanically from interpolation: a non-reporting bus repeats its last
 * fix, so `from === to` yields zero motion, and `interpolateVehicleFeatures`
 * clamps progress to [0,1] so a bus never extrapolates past its last real
 * position. `isSilent` is a classification predicate for callers/tests that want
 * to branch on "is this bus fully silent" (e.g. to force an immediate snap); it
 * is intentionally side-effect-free.
 */
export function isSilent(ageS: number, ttlS: number = DEFAULT_LIVE_TTL_S): boolean {
	return ageS >= SILENT_TTL_MULTIPLIER * Math.max(1, ttlS);
}

/**
 * Discrete (non-animated) opacity for `prefers-reduced-motion`. Still HONEST —
 * a long-silent bus is dimmed — but stepped, not a per-frame ramp: full, a
 * single mid step while fading, then the floor. No gradient = no per-frame fade.
 */
export function silenceOpacityDiscrete(ageS: number, ttlS: number = DEFAULT_LIVE_TTL_S): number {
	const ttl = Math.max(1, ttlS);
	if (ageS <= FRESH_TTL_MULTIPLIER * ttl) return 1;
	if (ageS >= SILENT_TTL_MULTIPLIER * ttl) return SILENCE_FLOOR_OPACITY;
	// One honest middle step (halfway between full and floor) for the fade window.
	return (1 + SILENCE_FLOOR_OPACITY) / 2;
}

/**
 * Read the live tier's ttl (seconds) out of the manifest files map, falling back
 * to the schema default. Accepts the loosely-typed manifest shape so callers can
 * pass `manifest.files` without importing the full Zod type here.
 */
export function liveTtlS(ttlFromManifest: number | null | undefined): number {
	return Math.max(1, ttlFromManifest ?? DEFAULT_LIVE_TTL_S);
}
