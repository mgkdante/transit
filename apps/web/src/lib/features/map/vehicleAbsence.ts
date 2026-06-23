// vehicleAbsence — the per-bus stale-GPS note for a focused map detail (pure).
//
// PR-A gives each vehicle its OWN fix time (reported_utc, nullable → updated_utc
// fallback), so we can honestly flag ONE silent bus (its fix older than
// STALE_CUTOFF_S) without the old global-snapshot caveat. For a focused VEHICLE
// detail, age it on its own fix vs the supplied clock; return { ageS } only when
// stale, else null (no note). MapHero feeds `sharedClock.serverNow` so the note
// appears/refreshes as a bus crosses the cutoff between polls.
//
// Side-effect-free: no stores, no map, no reactive reads. MapHero owns the two
// $derived wrappers that pass the live clock in.

import { fixAgeS, isVehicleStale } from '$lib/components/map/vehicleProjection';
import type { MapSelectionDetail } from './mapSelection';

/**
 * The per-bus not-reporting note: `{ ageS }` (seconds since this bus's own fix)
 * when a focused VEHICLE detail's fix is past the staleness cutoff, else null
 * (no note — a fresh bus, or a non-vehicle detail). `serverNow` MUST be the
 * skew-corrected `sharedClock.serverNow` so the age sits on the server timeline.
 */
export function vehicleAbsence(
	detail: MapSelectionDetail | null,
	serverNow: number,
): { ageS: number } | null {
	if (detail?.kind !== 'vehicle') return null;
	const ageS = fixAgeS(detail.vehicle.reported_utc, detail.vehicle.updated_utc, serverNow);
	return isVehicleStale(ageS) ? { ageS } : null;
}
