// map/vehicleSilence.ts — the HONESTY half of the kinetic map: per-vehicle
// "going stale" aging cue + a 3-state silence model.
//
// The position TWEEN (vehicleMotion.ts) already animates a bus ONLY between two
// real reported positions and clamps to [0,1] (never extrapolates past the last
// real fix). What it cannot express is the OTHER honest signal: a single bus can
// go quiet while the rest of the feed stays fresh. The global stale-dim
// (vehicleLayer.setStale) only fires when the WHOLE live tier is behind; it says
// nothing about one bus that stopped reporting.
//
// The model is THREE states, not "dim toward a floor":
//   · FRESH    — a normal report gap → FULL opacity.
//   · AGING    — getting stale → a gentle fade toward AGING_FLOOR_OPACITY. This
//                fade is ONLY the "going stale" cue; it is NOT how silence reads.
//   · SILENT   — past the silent threshold → the bus is FULL opacity again and is
//                flagged by an on-map marker (the "!" badge), NOT dimmed to a
//                floor. A long-silent bus is honestly "last seen N ago", surfaced
//                by a marker the eye can find, not erased into a faint ghost.
// To avoid a hard SNAP from the aging floor back up to full at the threshold, the
// opacity RAMPS back up across a short SILENT_RECOVER_S window — a continuous
// hand-off from the aging cue to the flagged-silent state.
//
// Thresholds are derived from the live tier's ttl (manifest live ttl, default
// 30s) so they track the publisher's cadence rather than a magic number:
//   · below FRESH_TTL_MULTIPLIER × ttl                 → full opacity (FRESH).
//   · between FRESH and SILENT windows                 → fade toward the aging
//                                                        floor (AGING).
//   · across the next SILENT_RECOVER_S after SILENT    → ramp back up to full.
//   · beyond that                                      → full opacity (SILENT,
//                                                        carries the marker).
// Rationale for the multipliers: one whole missed publish window (~1×ttl) is
// normal jitter and must NOT dim. We give it a little more headroom (1.5×) before
// the aging fade starts, then fade across another ~1.5 windows, reaching the
// aging floor at 3×ttl — the same "two missed windows = behind" spirit as the
// global stale threshold (2×ttl), just softened into a gradient and pushed out
// slightly so a merely-late bus is not punished alongside a truly silent one.

/** Fade starts once a vehicle's own report is older than this × ttl. */
export const FRESH_TTL_MULTIPLIER = 1.5;
/** The aging fade reaches its floor / the silent threshold at this × ttl. */
export const SILENT_TTL_MULTIPLIER = 3;
/**
 * Lowest opacity the AGING fade reaches (the bottom of the "going stale" cue,
 * just before the silent threshold). NOT a resting floor — once a bus crosses
 * into SILENT it ramps back to full opacity and is flagged by the on-map marker.
 */
export const AGING_FLOOR_OPACITY = 0.6;
/**
 * Seconds over which a freshly-silent bus ramps from the aging floor back up to
 * full opacity, so the hand-off from the aging fade to the flagged-silent state
 * is continuous (no snap).
 */
export const SILENT_RECOVER_S = 0.4;

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
 * Infinity), so it flags as silent rather than masquerading as fresh.
 */
export function silenceAgeS(updatedUtc: string | null | undefined, serverNow: number): number {
	if (updatedUtc == null) return Number.POSITIVE_INFINITY;
	const reportedMs = Date.parse(updatedUtc);
	if (Number.isNaN(reportedMs)) return Number.POSITIVE_INFINITY;
	return Math.max(0, (serverNow - reportedMs) / 1000);
}

/**
 * Per-vehicle icon opacity from its silence age — the 3-state model.
 *
 * FRESH (≤ fresh window) → full. AGING (fade window) → a linear ramp DOWN to
 * AGING_FLOOR_OPACITY: the "going stale" cue. SILENT (past the threshold) → the
 * bus is FULL opacity again (it is flagged by the on-map marker, not dimmed),
 * with a short SILENT_RECOVER_S ramp UP from the aging floor so the hand-off is
 * continuous instead of a snap. `ttlS` is clamped to a sane minimum so a
 * degenerate manifest can't collapse the windows.
 */
export function silenceOpacity(ageS: number, ttlS: number = DEFAULT_LIVE_TTL_S): number {
	const ttl = Math.max(1, ttlS);
	const fadeStart = FRESH_TTL_MULTIPLIER * ttl;
	const fadeEnd = SILENT_TTL_MULTIPLIER * ttl;
	if (ageS <= fadeStart) return 1;
	if (ageS < fadeEnd) {
		const progress = (ageS - fadeStart) / (fadeEnd - fadeStart);
		return 1 - progress * (1 - AGING_FLOOR_OPACITY);
	}
	if (ageS < fadeEnd + SILENT_RECOVER_S) {
		return AGING_FLOOR_OPACITY + ((ageS - fadeEnd) / SILENT_RECOVER_S) * (1 - AGING_FLOOR_OPACITY);
	}
	return 1;
}

/**
 * Helper predicate: true once a vehicle is past the fade window
 * (>= SILENT_TTL_MULTIPLIER × ttl), i.e. fully silent — it gets the on-map "!"
 * marker and is shown at full opacity.
 *
 * This does NOT drive the in-place "stop gliding" guarantee — that already
 * follows mechanically from interpolation: a non-reporting bus repeats its last
 * fix, so `from === to` yields zero motion, and `interpolateVehicleFeatures`
 * clamps progress to [0,1] so a bus never extrapolates past its last real
 * position. `isSilent` is a classification predicate for callers/tests that want
 * to branch on "is this bus fully silent" (e.g. to attach the marker); it is
 * intentionally side-effect-free.
 */
export function isSilent(ageS: number, ttlS: number = DEFAULT_LIVE_TTL_S): boolean {
	return ageS >= SILENT_TTL_MULTIPLIER * Math.max(1, ttlS);
}

/**
 * Discrete (non-animated) opacity for `prefers-reduced-motion`. Still HONEST —
 * an aging bus is dimmed — but stepped, not a per-frame ramp: full while fresh,
 * a single mid step while aging, then full again once silent (the marker, not a
 * floor, carries the silent state). No gradient = no per-frame fade.
 */
export function silenceOpacityDiscrete(ageS: number, ttlS: number = DEFAULT_LIVE_TTL_S): number {
	const ttl = Math.max(1, ttlS);
	if (ageS <= FRESH_TTL_MULTIPLIER * ttl) return 1;
	if (ageS >= SILENT_TTL_MULTIPLIER * ttl) return 1;
	// One honest middle step (halfway between full and the aging floor) for the
	// fade window.
	return (1 + AGING_FLOOR_OPACITY) / 2;
}

/**
 * Read the live tier's ttl (seconds) out of the manifest files map, falling back
 * to the schema default. Accepts the loosely-typed manifest shape so callers can
 * pass `manifest.files` without importing the full Zod type here.
 */
export function liveTtlS(ttlFromManifest: number | null | undefined): number {
	return Math.max(1, ttlFromManifest ?? DEFAULT_LIVE_TTL_S);
}
