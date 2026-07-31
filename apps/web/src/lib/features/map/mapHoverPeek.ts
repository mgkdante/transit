import type { LiveIndex } from '$lib/v1/live';
import type { OccupancyCode, RouteIndexEntry, StatusCode } from '$lib/v1/schemas';
import type { SlimStopEntry } from '$lib/v1';
import type { sharedClock } from '$lib/stores/clock.svelte';
import { fixAgeS, isVehicleStale } from '$lib/components/map';
import type { AbsenceReasonKey } from '$lib/site/absence';
import type { MapSelection } from './mapSelection';

type PeekLiveIndex = Pick<LiveIndex, 'byVehicleId' | 'vehiclesByStop'>;

export interface MapHoverPeekContext {
	readonly index: PeekLiveIndex;
	readonly stops: readonly SlimStopEntry[];
	readonly routesIndex: readonly RouteIndexEntry[];
	readonly clock: Pick<typeof sharedClock, 'serverNow'>;
}

export interface MapHoverPeekRouteRef {
	readonly id: string;
	readonly longName: string;
	readonly type: number | null;
	readonly labelInferred: boolean;
}

export interface MapHoverPeekStopRef {
	readonly id: string;
	readonly name: string;
	readonly nameAbsent: boolean;
}

export interface VehicleHoverPeek {
	readonly kind: 'vehicle';
	readonly id: string;
	readonly title: string;
	readonly route: MapHoverPeekRouteRef | null;
	readonly status: StatusCode;
	readonly delayMin: number | null;
	readonly occupancy: OccupancyCode | null;
	readonly nextStop: MapHoverPeekStopRef | null;
	readonly nextStopAbsence: AbsenceReasonKey;
	readonly notReportingAgeS: number | null;
}

export interface RouteHoverPeek {
	readonly kind: 'route';
	readonly id: string;
	readonly title: string;
	readonly longName: string;
	readonly type: number;
	readonly labelInferred: boolean;
	readonly visibleVehicleCount: number;
}

export interface StopHoverPeek {
	readonly kind: 'stop';
	readonly id: string;
	readonly title: string;
	readonly nameAbsent: boolean;
	readonly code: string | null;
	readonly vehicleCount: number;
}

export type MapHoverPeek = VehicleHoverPeek | RouteHoverPeek | StopHoverPeek;

function routeRef(
	routeId: string | null | undefined,
	routes: readonly RouteIndexEntry[],
): MapHoverPeekRouteRef | null {
	if (!routeId) return null;
	const route = routes.find((candidate) => candidate.id === routeId);
	const publishedLongName = route?.long?.trim();
	return {
		id: routeId,
		longName: publishedLongName || `Route ${routeId}`,
		type: route?.type ?? null,
		labelInferred: !publishedLongName,
	};
}

function stopRef(
	stopId: string | null | undefined,
	stops: readonly SlimStopEntry[],
): MapHoverPeekStopRef | null {
	if (!stopId) return null;
	const stop = stops.find((candidate) => candidate.id === stopId);
	if (!stop) return null;
	const publishedName = stop.name.trim();
	return {
		id: stop.id,
		name: publishedName || stop.id,
		nameAbsent: publishedName.length === 0,
	};
}

export function resolveMapHoverPeek(
	selection: MapSelection | null,
	context: MapHoverPeekContext,
): MapHoverPeek | null {
	if (!selection) return null;

	if (selection.kind === 'vehicle') {
		const vehicle = context.index.byVehicleId.get(selection.id);
		if (!vehicle) return null;
		const ageS = fixAgeS(vehicle.reported_utc, vehicle.updated_utc, context.clock.serverNow);
		const hasNextStop = vehicle.next_stop != null && vehicle.next_stop !== '';
		return {
			kind: 'vehicle',
			id: vehicle.id,
			title: vehicle.route ? `Route ${vehicle.route}` : `Bus ${vehicle.id}`,
			route: routeRef(vehicle.route, context.routesIndex),
			status: vehicle.status,
			delayMin: vehicle.delay_min ?? null,
			occupancy: vehicle.occupancy ?? null,
			nextStop: stopRef(vehicle.next_stop, context.stops),
			nextStopAbsence: hasNextStop ? 'not-in-schedule' : 'end-of-route',
			notReportingAgeS: isVehicleStale(ageS) ? ageS : null,
		};
	}

	if (selection.kind === 'route') {
		const route = context.routesIndex.find((candidate) => candidate.id === selection.id);
		if (!route) return null;
		const publishedLongName = route.long?.trim();
		let visibleVehicleCount = 0;
		for (const vehicle of context.index.byVehicleId.values()) {
			if (vehicle.route === route.id) visibleVehicleCount += 1;
		}
		return {
			kind: 'route',
			id: route.id,
			title: `Route ${route.id}`,
			longName: publishedLongName || `Route ${route.id}`,
			type: route.type,
			labelInferred: !publishedLongName,
			visibleVehicleCount,
		};
	}

	const stop = context.stops.find((candidate) => candidate.id === selection.id);
	if (!stop) return null;
	const publishedName = stop.name.trim();
	return {
		kind: 'stop',
		id: stop.id,
		title: publishedName || `Stop ${stop.id}`,
		nameAbsent: publishedName.length === 0,
		code: stop.code ?? null,
		vehicleCount: context.index.vehiclesByStop.get(stop.id)?.size ?? 0,
	};
}
