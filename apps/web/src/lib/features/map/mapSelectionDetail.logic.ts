// Pure presentation logic for the map selection-detail panel, lifted out of
// MapSelectionDetail.svelte so the component is markup + wiring only. Every helper
// is pure (copy/locale-bound ones take `t`/`locale` explicitly), so the whole module
// is unit-testable without a render harness. The null-honesty core (delayMaybe) routes
// a missing delay through the unknown-data layer — delay==null is NEVER "on time".

import { absent, known, stopNameFallback, type AbsenceReasonKey, type Maybe } from '$lib/site/absence';
import { ROUTE_TYPE_METRO } from '$lib/site/serviceWindow';
import { formatUtc } from '$lib/utils/time';
import type { Locale } from '$lib/i18n';
import type { StopDeparture, Vehicle } from '$lib/v1/schemas';
import type { MapSelectionDetail, MapStopRef, RouteMapDetail } from './mapSelection';
import type { MapSelectionDetailCopy } from './mapSelectionDetail.copy';

/**
 * True when the FOCUSED detail is a metro route (route_type 1). Metro carries no
 * live realtime in this feed, so a missing delay on a metro row is honestly
 * "no live data" (metro-no-realtime), never "not reported" or on-time.
 */
export function isDetailMetro(detail: MapSelectionDetail | null): boolean {
	return detail?.kind === 'vehicle'
		? detail.routeType === ROUTE_TYPE_METRO
		: detail?.kind === 'route'
			? (detail.route.type ?? null) === ROUTE_TYPE_METRO
			: false;
}

/**
 * A delay is a Maybe<number>: KNOWN (render the tag) or ABSENT with the honest
 * reason. delay==null must NEVER read as on-time. The reason is, in precedence:
 *   metro-no-realtime — a metro row (route_type 1): the feed never carries it;
 *   not-reporting     — the FOCUSED vehicle's own fix has gone stale (GPS quiet);
 *   not-reported      — otherwise: the live feed simply omitted this delay.
 * "On time" is reserved for delay===0 only (handled on the KNOWN branch).
 */
export function delayMaybe(
	delay: number | null | undefined,
	ctx: { stale?: boolean; metro?: boolean } = {},
): Maybe<number> {
	if (delay != null) return known(delay);
	const reason: AbsenceReasonKey = ctx.metro
		? 'metro-no-realtime'
		: ctx.stale
			? 'not-reporting'
			: 'not-reported';
	return absent<number>(reason);
}

export function delayKnownLabel(delay: number, t: MapSelectionDetailCopy): string {
	if (delay < 0) return t.early(delay);
	if (delay > 0) return t.late(delay);
	return t.onTime;
}

// Presentation-only tone for a KNOWN delay reading — maps the value to a dataviz
// status band so on-time / early / late punch in colour. The absent path renders
// AbsentValue (its own calm "unknown" tone), so this only handles known numbers.
export function delayTone(delay: number): string {
	if (delay < 0) return 'early';
	if (delay >= 5) return 'severe';
	if (delay > 0) return 'late';
	return 'on-time';
}

export function timeLabel(iso: string | null | undefined, locale: Locale): string {
	return iso ? formatUtc(iso, locale, { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}

// Short relative age for the not-reporting note: seconds under ~90, else minutes.
export function formatAge(seconds: number): string {
	return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

// The display name for a stop ref — the resolved name, or the honest labelled
// fallback ("Stop {id} (name unavailable)") when the static index did not name
// it. Used for the click aria so AT never hears a bare id read as a name.
export function stopDisplayName(ref: MapStopRef, locale: Locale): string {
	return ref.nameAbsent ? stopNameFallback(ref.id, locale) : ref.name;
}

export function vehicleForDeparture(
	vehicles: readonly Vehicle[],
	departure: StopDeparture,
): Vehicle | null {
	return departure.trip
		? (vehicles.find((vehicle) => vehicle.trip === departure.trip) ?? null)
		: null;
}

export function directionLabel(item: RouteMapDetail, t: MapSelectionDetailCopy): string {
	if (item.directions.length === 1) return item.directions[0]?.label ?? t.noData;
	return item.directions.length > 0
		? item.directions.map((direction) => direction.label).join(' / ')
		: t.noData;
}
