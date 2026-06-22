// map/vehicleSilence.ts — per-vehicle report-age helpers for the kinetic map.
//
// HISTORY / WHY THESE NO LONGER FADE:
// S5 originally shipped a per-vehicle "going stale" aging fade here: a single bus
// would dim toward a floor as its own `updated_utc` aged, on the theory that one
// bus can go quiet while the rest of the feed stays fresh. That theory does not
// hold for this feed. The pipeline (apps/db .../builders/live.py) stamps EVERY
// vehicle with `updated_utc = captured_at_utc` — the single feed-snapshot capture
// time. So all buses share ONE identical age: the per-vehicle fade can never
// distinguish a stuck bus from its neighbours (they all fade together), and at
// the old fade-start (~45s) it merely flickered on and off with normal 30s-poll
// jitter. It was honesty theatre, not honesty.
//
// Decision: buses stay SOLID in normal operation. Staleness is now a GLOBAL
// signal only:
//   · the feed-not-responding banner appears when the whole live feed genuinely
//     stalls, and
//   · the global stale-dim (vehicleLayer.setStale, driven by live.isStale at the
//     90s = 3×ttl threshold) dims the whole tier together.
// Both reflect the truth of a uniform-capture-time feed; a per-vehicle gradient
// does not. So `silenceOpacity` / `silenceOpacityDiscrete` now ALWAYS return 1.
//
// What remains here is the still-useful, still-honest machinery: `silenceAgeS`
// (seconds since the shared snapshot capture time, on the server clock) and
// `liveTtlS` / `DEFAULT_LIVE_TTL_S` (the publisher's cadence). The opacity
// functions are kept as no-op (always-1) shims so callers and the per-frame
// refresher need not be rewired — they now compute a constant, which folds into a
// stable signature and harmlessly produces no re-feeds.

/** Default live ttl (seconds) when the manifest omits it — mirrors the schema. */
export const DEFAULT_LIVE_TTL_S = 30;

/**
 * Seconds since a vehicle's report timestamp, on the server's timeline.
 *
 * NOTE: for this feed `updated_utc` is the SHARED snapshot capture time
 * (`captured_at_utc`), identical across every vehicle — so this age is really the
 * feed's age, not one bus's age. Still useful for a "last seen" hover and for the
 * global staleness logic.
 *
 * `serverNow` MUST be `sharedClock.serverNow` (skew-corrected) so the age is
 * immune to a wrong client clock — both operands then sit on the server's
 * timeline, exactly like the freshness badge. Clamped to >= 0 (a report stamped
 * slightly in the future from skew reads as "0s ago", never negative). A missing
 * or unparseable `updated_utc` is treated as maximally silent (returns
 * Infinity).
 */
export function silenceAgeS(updatedUtc: string | null | undefined, serverNow: number): number {
	if (updatedUtc == null) return Number.POSITIVE_INFINITY;
	const reportedMs = Date.parse(updatedUtc);
	if (Number.isNaN(reportedMs)) return Number.POSITIVE_INFINITY;
	return Math.max(0, (serverNow - reportedMs) / 1000);
}

/**
 * Per-vehicle icon opacity — now ALWAYS 1 (buses are solid in normal operation).
 *
 * It used to fade a single aging bus toward a floor, but `updated_utc` is the
 * uniform snapshot capture time, so every bus shares one age: a per-vehicle fade
 * cannot single out a stuck bus, and at the old start point it only flickered on
 * normal poll jitter. Staleness is signalled globally instead — by the
 * feed-not-responding banner and the global stale-dim (live.isStale at 90s). This
 * shim keeps the call site and the per-frame refresher intact; they now compute a
 * constant, which yields a stable signature and no re-feeds.
 *
 * `ageS` / `ttlS` are accepted (and ignored) so existing callers need no change.
 */
export function silenceOpacity(_ageS: number, _ttlS: number = DEFAULT_LIVE_TTL_S): number {
	return 1;
}

/**
 * Discrete (reduced-motion) counterpart to `silenceOpacity` — also ALWAYS 1, for
 * the same reason: there is no honest per-vehicle staleness gradient to step
 * through when every bus shares the snapshot capture time. Kept as a no-op shim so
 * the reduced-motion branch in callers need not be rewired.
 */
export function silenceOpacityDiscrete(_ageS: number, _ttlS: number = DEFAULT_LIVE_TTL_S): number {
	return 1;
}

/**
 * Read the live tier's ttl (seconds) out of the manifest files map, falling back
 * to the schema default. Accepts the loosely-typed manifest shape so callers can
 * pass `manifest.files` without importing the full Zod type here.
 */
export function liveTtlS(ttlFromManifest: number | null | undefined): number {
	return Math.max(1, ttlFromManifest ?? DEFAULT_LIVE_TTL_S);
}
