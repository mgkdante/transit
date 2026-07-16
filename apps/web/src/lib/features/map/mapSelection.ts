import type { LiveIndex } from '$lib/v1/live';
import {
	routeDirectionVariants,
	type RouteDirectionVariant,
} from '$lib/components/map/routeDirection';
import type {
	Alert,
	RouteDirection,
	RouteFile,
	RouteStop,
	StopDeparture,
	StopEta,
	StopFile,
	StopIndexEntry,
	Trip,
	Vehicle,
} from '$lib/v1/schemas';
import { formatClock } from '$lib/utils/time';
import type { AbsenceReasonKey } from '$lib/site/absence';

export type MapSelection =
	| { readonly kind: 'vehicle'; readonly id: string }
	| { readonly kind: 'stop'; readonly id: string }
	| {
			readonly kind: 'route';
			readonly id: string;
			readonly direction?: number | null;
			readonly variantKey?: string | null;
	  };

// A route selection's direction / variant only — null for point entities. Used by
// the identity check so picking the SAME route in a different direction reads as a
// different selection (the line re-highlights), while a bus/stop ignores both.
function selectionDirection(selection: MapSelection): number | null {
	return selection.kind === 'route' ? (selection.direction ?? null) : null;
}

function selectionVariantKey(selection: MapSelection): string | null {
	return selection.kind === 'route' ? (selection.variantKey ?? null) : null;
}

/** Two selections refer to the SAME entity: kind + id match, and (for a route) the
 *  same picked direction + variant. The map orchestrator uses it to dedupe hover
 *  churn and to decide whether a detail pick pushes onto the back-stack. */
export function sameSelection(a: MapSelection, b: MapSelection): boolean {
	return (
		a.kind === b.kind &&
		a.id === b.id &&
		selectionDirection(a) === selectionDirection(b) &&
		selectionVariantKey(a) === selectionVariantKey(b)
	);
}

/** Null-tolerant {@link sameSelection}: two nulls are equal; one null is not. */
export function sameNullableSelection(a: MapSelection | null, b: MapSelection | null): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	return sameSelection(a, b);
}

interface ResolveContext {
	readonly index: LiveIndex;
	readonly stops: readonly StopIndexEntry[];
	readonly routes?: readonly RouteFile[] | null;
	readonly stopFiles?: readonly StopFile[] | null;
	readonly alerts?: readonly Alert[] | null;
	readonly now?: Date;
}

export interface MapStopRef {
	readonly id: string;
	readonly name: string;
	readonly seq: number | null;
	readonly etaUtc?: string | null;
	readonly delayMin?: number | null;
	/**
	 * True when no name resolved from the static index — `name` then carries the
	 * bare id only as a stable handle, and the surface renders the honest labelled
	 * fallback ("Stop {id} (name unavailable)") through the absence layer instead of
	 * leaking the id as if it were a name.
	 */
	readonly nameAbsent: boolean;
}

export interface StopRouteTimes {
	readonly route: string;
	readonly headsign: string | null;
	readonly pastTimes: readonly string[];
	readonly futureTimes: readonly string[];
	readonly liveDepartures: readonly StopDeparture[];
}

export interface RouteDirectionStops {
	readonly variantKey: string;
	readonly dir: number;
	readonly headsign: string | null;
	readonly label: string;
	readonly terminalLabel: string | null;
	readonly stops: readonly MapStopRef[];
	/**
	 * True when `label` is the SYNTHESIZED "Direction {dir}" placeholder (no
	 * terminal, no headsign). The surface marks it "(inferred)" via the absence
	 * layer so a computed direction never reads as a published headsign.
	 */
	readonly labelInferred: boolean;
}

export interface VehicleMapDetail {
	readonly kind: 'vehicle';
	readonly id: string;
	readonly title: string;
	readonly vehicle: Vehicle;
	readonly trip: Trip | null;
	readonly route: RouteFile | null;
	readonly routeDirection: RouteDirection | null;
	readonly routeDirectionVariant: RouteDirectionVariant | null;
	readonly nextStop: StopIndexEntry | null;
	/**
	 * The honest reason there is no RESOLVED next stop (only meaningful when
	 * `nextStop` is null). `not-in-schedule` when the feed named a next stop we
	 * could not resolve to a real stop (render "Next stop unknown", never the raw
	 * id); `end-of-route` when the feed named no next stop at all (the trip ended).
	 */
	readonly nextStopAbsence: AbsenceReasonKey;
	readonly pastStops: readonly MapStopRef[];
	readonly nextStops: readonly MapStopRef[];
	readonly alerts: readonly Alert[] | null;
	/**
	 * GTFS route_type of this vehicle's route (null when unknown). The surface uses
	 * route_type 1 (metro) plus the metro realtime gap to explain a missing delay
	 * as "no live data" rather than "not reported".
	 */
	readonly routeType: number | null;
}

export interface StopMapDetail {
	readonly kind: 'stop';
	readonly id: string;
	readonly title: string;
	readonly stop: StopIndexEntry;
	readonly departures: readonly StopDeparture[];
	readonly vehicles: readonly Vehicle[];
	readonly routeTimes: readonly StopRouteTimes[];
	readonly alerts: readonly Alert[] | null;
}

export interface RouteMapDetail {
	readonly kind: 'route';
	readonly id: string;
	readonly title: string;
	readonly route: RouteFile;
	readonly direction: RouteDirection | null;
	readonly directions: readonly RouteDirectionStops[];
	readonly vehicles: readonly Vehicle[];
	readonly alerts: readonly Alert[] | null;
}

export type MapSelectionDetail = VehicleMapDetail | StopMapDetail | RouteMapDetail;

function hasValue(
	values: readonly string[] | undefined,
	value: string | null | undefined,
): boolean {
	return value != null && values != null && values.includes(value);
}

function alertMatchesVehicle(alert: Alert, vehicle: Vehicle): boolean {
	return hasValue(alert.routes, vehicle.route) || hasValue(alert.stops, vehicle.next_stop);
}

function alertMatchesStop(alert: Alert, stopId: string): boolean {
	return hasValue(alert.stops, stopId);
}

function alertMatchesRoute(alert: Alert, routeId: string): boolean {
	return hasValue(alert.routes, routeId);
}

function findStop(
	stops: readonly StopIndexEntry[],
	stopId: string | null | undefined,
): StopIndexEntry | null {
	return stopId ? (stops.find((stop) => stop.id === stopId) ?? null) : null;
}

function findRoute(
	routes: readonly RouteFile[] | null | undefined,
	routeId: string | null | undefined,
): RouteFile | null {
	return routeId ? ((routes ?? []).find((route) => route.id === routeId) ?? null) : null;
}

function findStopFile(
	stopFiles: readonly StopFile[] | null | undefined,
	stopId: string | null | undefined,
): StopFile | null {
	return stopId ? ((stopFiles ?? []).find((stop) => stop.id === stopId) ?? null) : null;
}

function vehiclesHeadingToStop(index: LiveIndex, stopId: string): Vehicle[] {
	const ids = index.vehiclesByStop.get(stopId);
	if (!ids) return [];
	return Array.from(ids)
		.map((id) => index.byVehicleId.get(id))
		.filter((vehicle): vehicle is Vehicle => vehicle != null);
}

function vehiclesOnRoute(index: LiveIndex, routeId: string): Vehicle[] {
	const ids = index.vehiclesByRoute.get(routeId);
	if (!ids) return [];
	return Array.from(ids)
		.map((id) => index.byVehicleId.get(id))
		.filter((vehicle): vehicle is Vehicle => vehicle != null);
}

function routeCompare(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function orderedRouteStops(direction: RouteDirection | null | undefined): RouteStop[] {
	return [...(direction?.stops ?? [])].sort((a, b) => a.seq - b.seq);
}

/** Resolve a stop's display name, or null when neither the route stop nor the
 *  static index names it (the caller then marks the ref name-absent). */
function resolveStopName(
	stopId: string,
	stops: readonly StopIndexEntry[],
	routeStop?: Pick<RouteStop, 'name'> | null,
): string | null {
	return routeStop?.name ?? findStop(stops, stopId)?.name ?? null;
}

function toStopRef(
	stopId: string,
	stops: readonly StopIndexEntry[],
	routeStop?: RouteStop | null,
	eta?: StopEta | null,
): MapStopRef {
	const resolved = resolveStopName(stopId, stops, routeStop);
	return {
		id: stopId,
		// Keep the bare id as the stable handle when unresolved; the surface renders
		// the honest "Stop {id} (name unavailable)" fallback from `nameAbsent`.
		name: resolved ?? stopId,
		nameAbsent: resolved == null,
		seq: routeStop?.seq ?? null,
		...(eta ? { etaUtc: eta.eta_utc, delayMin: eta.delay_min ?? null } : {}),
	};
}

function directionScore(direction: RouteDirection, anchors: readonly string[]): number {
	const ordered = orderedRouteStops(direction);
	if (ordered.length === 0 || anchors.length === 0) return 0;

	let score = 0;
	let cursor = -1;
	for (const anchor of anchors) {
		const idx = ordered.findIndex((stop, i) => i > cursor && stop.id === anchor);
		if (idx >= 0) {
			score += 10;
			cursor = idx;
		} else if (ordered.some((stop) => stop.id === anchor)) {
			score += 1;
		}
	}
	return score;
}

function resolveVehicleDirectionVariant(
	route: RouteFile | null,
	vehicle: Vehicle,
	trip: Trip | null,
): RouteDirectionVariant | null {
	const variants = route ? routeDirectionVariants(route) : [];
	if (variants.length === 0) return null;
	const anchors = (trip?.stops ?? []).map((stop) => stop.stop);
	const fallbackAnchors = vehicle.next_stop ? [vehicle.next_stop] : [];
	const scoredAnchors = anchors.length > 0 ? anchors : fallbackAnchors;
	if (scoredAnchors.length === 0) return variants[0] ?? null;

	const [best] = [...variants].sort(
		(a, b) =>
			directionScore(b.direction, scoredAnchors) - directionScore(a.direction, scoredAnchors),
	);
	return best && directionScore(best.direction, scoredAnchors) > 0 ? best : (variants[0] ?? null);
}

function buildVehicleStopProgress(
	vehicle: Vehicle,
	trip: Trip | null,
	routeDirection: RouteDirection | null,
	stops: readonly StopIndexEntry[],
): { pastStops: MapStopRef[]; nextStops: MapStopRef[] } {
	const ordered = orderedRouteStops(routeDirection);
	const routeStopById = new Map(ordered.map((stop) => [stop.id, stop]));
	const tripStops = trip?.stops ?? [];
	const anchorId = tripStops[0]?.stop ?? vehicle.next_stop ?? null;
	const anchorIndex = anchorId ? ordered.findIndex((stop) => stop.id === anchorId) : -1;

	const pastStops =
		anchorIndex > 0
			? ordered.slice(0, anchorIndex).map((stop) => toStopRef(stop.id, stops, stop))
			: [];

	if (tripStops.length > 0) {
		return {
			pastStops,
			nextStops: tripStops.map((eta) =>
				toStopRef(eta.stop, stops, routeStopById.get(eta.stop) ?? null, eta),
			),
		};
	}

	if (anchorIndex >= 0) {
		return {
			pastStops,
			nextStops: ordered.slice(anchorIndex).map((stop) => toStopRef(stop.id, stops, stop)),
		};
	}

	return { pastStops, nextStops: [] };
}

function minutesOfDay(value: string): number | null {
	const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
	return hours * 60 + minutes;
}

function currentMontrealMinutes(now: Date): number {
	const clock = formatClock(now, 'en');
	return minutesOfDay(clock) ?? 0;
}

function splitTimes(
	times: readonly string[] | undefined,
	nowMinutes: number,
): {
	pastTimes: string[];
	futureTimes: string[];
} {
	const pastTimes: string[] = [];
	const futureTimes: string[] = [];
	const validTimes: string[] = [];
	for (const time of times ?? []) {
		const minutes = minutesOfDay(time);
		if (minutes == null) continue;
		validTimes.push(time);
		if (minutes < nowMinutes) pastTimes.push(time);
		else futureTimes.push(time);
	}
	return {
		pastTimes: pastTimes.length > 0 ? pastTimes : validTimes,
		futureTimes: futureTimes.length > 0 ? futureTimes : validTimes,
	};
}

function buildStopRouteTimes(
	stopFile: StopFile | null,
	departures: readonly StopDeparture[],
	now: Date,
): StopRouteTimes[] {
	const liveByRoute = new Map<string, StopDeparture[]>();
	for (const departure of departures) {
		if (!departure.route) continue;
		const current = liveByRoute.get(departure.route) ?? [];
		current.push(departure);
		liveByRoute.set(departure.route, current);
	}

	const nowMinutes = currentMontrealMinutes(now);
	const byRoute = new Map<string, StopRouteTimes>();
	for (const scheduled of stopFile?.scheduled ?? []) {
		const split = splitTimes(scheduled.times, nowMinutes);
		byRoute.set(scheduled.route, {
			route: scheduled.route,
			headsign: scheduled.headsign ?? null,
			pastTimes: split.pastTimes,
			futureTimes: split.futureTimes,
			liveDepartures: liveByRoute.get(scheduled.route) ?? [],
		});
	}

	for (const [route, liveDepartures] of liveByRoute) {
		if (byRoute.has(route)) continue;
		byRoute.set(route, {
			route,
			headsign: null,
			pastTimes: [],
			futureTimes: [],
			liveDepartures,
		});
	}

	return [...byRoute.values()].sort((a, b) => routeCompare(a.route, b.route));
}

function routeDirectionStops(
	route: RouteFile,
	selectedVariant: RouteDirectionVariant | null,
): RouteDirectionStops[] {
	const variants = selectedVariant ? [selectedVariant] : routeDirectionVariants(route);
	return variants.map((variant) => ({
		variantKey: variant.key,
		dir: variant.dir,
		headsign: variant.headsign,
		label: variant.label,
		terminalLabel: variant.terminalLabel,
		labelInferred: variant.labelInferred,
		stops: variant.stops.map((stop) => ({
			id: stop.id,
			// Keep the id as a stable handle when the route stop has no name; the
			// surface renders the honest labelled fallback from `nameAbsent`.
			name: stop.name ?? stop.id,
			nameAbsent: stop.name == null,
			seq: stop.seq,
		})),
	}));
}

export function resolveMapSelection(
	selection: MapSelection | null,
	context: ResolveContext,
): MapSelectionDetail | null {
	if (!selection) return null;

	if (selection.kind === 'vehicle') {
		const vehicle = context.index.byVehicleId.get(selection.id);
		if (!vehicle) return null;
		const trip = vehicle.trip ? (context.index.byTripId.get(vehicle.trip) ?? null) : null;
		const route = findRoute(context.routes, vehicle.route ?? trip?.route);
		const routeDirectionVariant = resolveVehicleDirectionVariant(route, vehicle, trip);
		const routeDirection = routeDirectionVariant?.direction ?? null;
		const { pastStops, nextStops } = buildVehicleStopProgress(
			vehicle,
			trip,
			routeDirection,
			context.stops,
		);

		const nextStop = findStop(context.stops, vehicle.next_stop);
		// When there is no RESOLVED next stop, say WHY honestly: the feed named one we
		// could not resolve (not-in-schedule → "Next stop unknown") vs the feed named
		// none at all (end-of-route → the trip has ended). Never leak the raw id.
		const hasNamedNextStop = vehicle.next_stop != null && vehicle.next_stop !== '';
		const nextStopAbsence: AbsenceReasonKey = hasNamedNextStop ? 'not-in-schedule' : 'end-of-route';

		return {
			kind: 'vehicle',
			id: vehicle.id,
			title: vehicle.route ? `Route ${vehicle.route}` : `Bus ${vehicle.id}`,
			vehicle,
			trip,
			route,
			routeDirection,
			routeDirectionVariant,
			nextStop,
			nextStopAbsence,
			pastStops,
			nextStops,
			alerts:
				context.alerts == null
					? null
					: context.alerts.filter((alert) => alertMatchesVehicle(alert, vehicle)),
			routeType: route?.type ?? null,
		};
	}

	if (selection.kind === 'route') {
		const route = (context.routes ?? []).find((candidate) => candidate.id === selection.id);
		if (!route) return null;
		const variants = routeDirectionVariants(route);
		const selectedVariant =
			selection.variantKey == null
				? selection.direction == null
					? null
					: (variants.find((candidate) => candidate.dir === selection.direction) ?? null)
				: (variants.find((candidate) => candidate.key === selection.variantKey) ?? null);
		const direction = selectedVariant?.direction ?? null;
		return {
			kind: 'route',
			id: route.id,
			title: `Route ${route.id}`,
			route,
			direction,
			directions: routeDirectionStops(route, selectedVariant),
			vehicles: vehiclesOnRoute(context.index, route.id),
			alerts:
				context.alerts == null
					? null
					: context.alerts.filter((alert) => alertMatchesRoute(alert, route.id)),
		};
	}

	const stop = findStop(context.stops, selection.id);
	if (!stop) return null;

	return {
		kind: 'stop',
		id: stop.id,
		title: stop.name,
		stop,
		departures: context.index.byStopId.get(stop.id) ?? [],
		vehicles: vehiclesHeadingToStop(context.index, stop.id),
		routeTimes: buildStopRouteTimes(
			findStopFile(context.stopFiles, stop.id),
			context.index.byStopId.get(stop.id) ?? [],
			context.now ?? new Date(),
		),
		alerts:
			context.alerts == null
				? null
				: context.alerts.filter((alert) => alertMatchesStop(alert, stop.id)),
	};
}
