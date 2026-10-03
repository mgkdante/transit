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

export { delayTone } from '$lib/site/delayPresentation';
import type { StopDeparture, Vehicle } from '$lib/v1/schemas';
import type { MapSelectionDetail, MapStopRef, RouteMapDetail } from './mapSelection';
import { MAP_SELECTION_DETAIL_COPY, type MapSelectionDetailCopy } from './mapSelectionDetail.copy';

export type DetailAction = { readonly href: string; readonly label: string };

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

export function isDetailMetro(detail: MapSelectionDetail | null): boolean {
	return detail?.kind === 'vehicle'
		? detail.routeType === ROUTE_TYPE_METRO
		: detail?.kind === 'route'
			? (detail.route.type ?? null) === ROUTE_TYPE_METRO
			: false;
}

export function vehicleFieldAbsence(
	ctx: { stale?: boolean; metro?: boolean } = {},
): AbsenceReasonKey {
	return ctx.metro ? 'metro-no-realtime' : ctx.stale ? 'not-reporting' : 'not-reported';
}

export function delayMaybe(
	delay: number | null | undefined,
	ctx: { stale?: boolean; metro?: boolean } = {},
): Maybe<number> {
	if (delay != null) return known(delay);
	return absent<number>(vehicleFieldAbsence(ctx));
}

export function delayKnownLabel(delay: number, t: MapSelectionDetailCopy): string {
	return delayLabel(delay, t);
}

export function timeLabel(
	iso: string | null | undefined,
	locale: Locale,
	timeZone?: string,
): string {
	return iso
		? formatUtc(iso, locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
		: '';
}

export function formatAge(seconds: number): string {
	return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
}

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
