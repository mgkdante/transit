// Pure presentation logic for the map selection-detail panel, lifted out of
// MapSelectionDetail.svelte so the component is markup + wiring only. Every helper
// is pure (copy/locale-bound ones take `t`/`locale` explicitly), so the whole module
// is unit-testable without a render harness. The null-honesty core (delayMaybe) routes
// a missing delay through the unknown-data layer — delay==null is NEVER "on time".

import {
	absent,
	absenceShort,
	known,
	stopNameFallback,
	type AbsenceReasonKey,
	type Maybe,
} from '$lib/site/absence';
import { ROUTE_TYPE_METRO } from '$lib/site/serviceWindow';
import { delayLabel } from '$lib/site/delayPresentation';
import { formatUtc } from '$lib/utils/time';
import { localizeHref, type Locale } from '$lib/i18n';
import { routeFor } from '$lib/nav';

// The dataviz status tone for a KNOWN delay is the site-wide shared helper — the
// map's known-only callers (delayMaybe routes the absent case to AbsentValue, so
// delayTone only ever sees a real number) reuse it rather than re-deriving the
// thresholds.
export { delayTone } from '$lib/site/delayPresentation';
import type { StopDeparture, Vehicle } from '$lib/v1/schemas';
import type { MapSelectionDetail, MapStopRef, RouteMapDetail } from './mapSelection';
import { MAP_SELECTION_DETAIL_COPY, type MapSelectionDetailCopy } from './mapSelectionDetail.copy';

export type DetailAction = { readonly href: string; readonly label: string };

/** Localized shell identity. The resolver title remains data, never chrome copy. */
export function detailIdentity(detail: MapSelectionDetail, locale: Locale): string {
	const t = MAP_SELECTION_DETAIL_COPY[locale];
	if (detail.kind === 'vehicle') return `${t.bus} ${detail.vehicle.id}`;
	if (detail.kind === 'route') return `${t.route} ${detail.id}`;
	return stopDisplayName(
		{
			id: detail.stop.id,
			name: detail.stop.name || detail.stop.id,
			seq: null,
			nameAbsent: (detail.stop as { nameAbsent?: boolean }).nameAbsent ?? !detail.stop.name,
		},
		locale,
	);
}

/** The one honest exit action for a resolved map detail. */
export function detailActions(detail: MapSelectionDetail, locale: Locale): DetailAction | null {
	const t = MAP_SELECTION_DETAIL_COPY[locale];
	if (detail.kind === 'route') {
		return {
			href: localizeHref(routeFor({ kind: 'line', id: detail.id }), locale),
			label: t.openFullRoute(detail.id),
		};
	}
	if (detail.kind === 'stop') {
		return {
			href: localizeHref(routeFor({ kind: 'stop', id: detail.stop.id }), locale),
			label: t.openFullStop(detail.stop.id),
		};
	}
	if (detail.vehicle.trip) {
		return {
			href: localizeHref(routeFor({ kind: 'trip', id: detail.vehicle.trip }), locale),
			label: t.openFullTrip(detail.vehicle.trip),
		};
	}
	return detail.vehicle.route
		? {
				href: localizeHref(routeFor({ kind: 'line', id: detail.vehicle.route }), locale),
				label: t.openFullRoute(detail.vehicle.route),
			}
		: null;
}

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
 * The honest absence reason for ANY per-vehicle live field (delay, route,
 * crowding, trip) given its context, in precedence:
 *   metro-no-realtime — a metro row (route_type 1): the feed never carries it;
 *   not-reporting     — the FOCUSED vehicle's own fix has gone stale (GPS quiet);
 *   not-reported      — otherwise: the live feed simply omitted this field.
 * The single source of truth so EVERY absent cell in the vehicle panel reads the
 * same honest reason — a metro vehicle's missing crowding says "no live data
 * here", never "not reported in the live feed".
 */
export function vehicleFieldAbsence(
	ctx: { stale?: boolean; metro?: boolean } = {},
): AbsenceReasonKey {
	return ctx.metro ? 'metro-no-realtime' : ctx.stale ? 'not-reporting' : 'not-reported';
}

/**
 * A delay is a Maybe<number>: KNOWN (render the tag) or ABSENT with the honest
 * reason (see vehicleFieldAbsence). delay==null must NEVER read as on-time;
 * "On time" is reserved for delay===0 only (handled on the KNOWN branch).
 */
export function delayMaybe(
	delay: number | null | undefined,
	ctx: { stale?: boolean; metro?: boolean } = {},
): Maybe<number> {
	if (delay != null) return known(delay);
	return absent<number>(vehicleFieldAbsence(ctx));
}

// Known-delay label via the site-wide shared delayLabel. `delay` is non-null here
// (the absent case is handled by delayMaybe → AbsentValue), and MapSelectionDetailCopy
// supplies early/late/onTime (no `noDelay`), so the null branch is never reached.
export function delayKnownLabel(delay: number, t: MapSelectionDetailCopy): string {
	return delayLabel(delay, t);
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

export function directionLabel(item: RouteMapDetail, locale: Locale): string {
	if (item.directions.length === 1)
		return item.directions[0]?.label ?? absenceShort('not-in-schedule', locale);
	return item.directions.length > 0
		? item.directions.map((direction) => direction.label).join(' / ')
		: absenceShort('not-in-schedule', locale);
}
