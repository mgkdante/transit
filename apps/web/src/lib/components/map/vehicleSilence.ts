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
// does not. The per-vehicle opacity fade (and its no-op `silenceOpacity` /
// `silenceOpacityDiscrete` shims) is gone: `vehicleLayer.toVehicleFeatures` now
// emits a constant opacity of 1.
//
// What remains here is the still-useful, still-honest machinery: `silenceAgeS`
// (seconds since the shared snapshot capture time, on the server clock) and
// `liveTtlS` / `DEFAULT_LIVE_TTL_S` (the publisher's cadence).

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
 * Read the live tier's ttl (seconds) out of the manifest files map, falling back
 * to the schema default. Accepts the loosely-typed manifest shape so callers can
 * pass `manifest.files` without importing the full Zod type here.
 */
export function liveTtlS(ttlFromManifest: number | null | undefined): number {
	return Math.max(1, ttlFromManifest ?? DEFAULT_LIVE_TTL_S);
}
