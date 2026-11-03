import { SvelteSet } from 'svelte/reactivity';
import type { Locale } from '$lib/i18n';
import type { RouteFile, StopFile } from '$lib/v1';
import type { Alert } from '$lib/v1/schemas';
import type { LiveStore } from '$lib/v1/live/store.svelte';
import type { FilterStore, Chip } from '$lib/filters';
import type * as StaticRepositories from '$lib/v1/repositories/static';
import type { MapFocus } from '$lib/search/mapFocus';
import { createResource } from '$lib/v1/resource.svelte';
import { createMapSelectionController } from './selectionSession/mapSelectionController.svelte';
import {
	resolveMapSelection,
	type MapSelection,
	type MapSelectionDetail as MapSelectionDetailModel,
} from './selectionSession/mapSelection';
import { createSelectionGrace } from './selectionSession/selectionGrace.svelte';
import { isMapFocusReady } from './selectionSession/mapFocusReadiness';
import { vehicleAbsence } from './selectionSession/vehicleAbsence';
import { resolveMapHoverPeek } from './mapHoverPeek';
import { buildAlertEntitySets, vehicleHasAlert } from './mapAlerts';
import { mapCopy } from './map.copy';
import * as ownerCleanup from './mapOwnerCleanup';

export interface MapSelectionSessionOptions {
	readonly live: Pick<
		LiveStore,
		'index' | 'vehicles' | 'alerts' | 'familyStates' | 'vehiclesIsStale' | 'subscribeFamilies'
	>;
	readonly repositories: Pick<
		typeof StaticRepositories,
		'getRoute' | 'getStop' | 'getStopsIndexSlim' | 'getRoutesIndex'
	>;
	readonly filters: FilterStore;
	readonly locale: Locale;
	readonly timeZone?: string;
	readonly serverNow: () => number;
	readonly alertsAvailable?: boolean;
}

/** Owns a selection and its resources for the lifetime of the calling effect owner. */
export function createMapSelectionSession(options: MapSelectionSessionOptions) {
	const {
		live,
		repositories: { getRoute, getStop, getStopsIndexSlim, getRoutesIndex },
		filters,
		locale,
	} = options;
	const manifest = { tz: options.timeZone };
	const clock = {
		get serverNow() {
			return options.serverNow();
		},
	};
	const alertsAvailable = options.alertsAvailable ?? true;
	const t = mapCopy(locale, '');
	const selectionController = createMapSelectionController();
	const selected = $derived(selectionController.selected);
	const hovered = $derived(selectionController.hovered);
	const detailOpen = $derived(selectionController.detailOpen);
	function releaseMapOwner(dispose: () => void) {
		ownerCleanup.releaseWithRetry(dispose, (error) =>
			ownerCleanup.reportCleanupFailure('MapHero cleanup failed', error),
		);
	}
	const stops = createResource((signal) => getStopsIndexSlim({ signal }));
	const routesIndex = createResource((signal) => getRoutesIndex({ signal }));
	const selectedRouteIds = $derived(Array.from(filters.routes).sort());
	const selectedRoutes = createResource<RouteFile[]>(
		async (signal) => {
			const ids = selectedRouteIds;
			const routes = await Promise.all(ids.map((id) => getRoute(id, { signal })));
			return routes.filter((route): route is RouteFile => route != null);
		},
		{
			key: () => selectedRouteIds.join('\u0000'),
			enabled: () => selectedRouteIds.length > 0,
		},
	);

	$effect(() => {
		const release =
			selected?.kind === 'vehicle'
				? live.subscribeFamilies(['trips'])
				: selected?.kind === 'stop'
					? live.subscribeFamilies(['departures'])
					: null;
		if (!release) return;
		return () => releaseMapOwner(release);
	});

	const stopList = $derived(stops.data?.stops ?? []);
	const focusedRouteId = $derived.by<string | null>(() => {
		if (!selected) return null;
		if (selected.kind === 'route') return selected.id;
		if (selected.kind === 'vehicle') {
			return live.index.byVehicleId.get(selected.id)?.route ?? null;
		}
		return null;
	});
	const focusedStopId = $derived.by<string | null>(() => {
		if (!selected) return null;
		if (selected.kind === 'stop') return selected.id;
		return null;
	});
	const focusedRoute = createResource<RouteFile | null>(
		async (signal) => {
			const id = focusedRouteId;
			return id ? getRoute(id, { signal }) : null;
		},
		{
			key: () => focusedRouteId,
			enabled: () => focusedRouteId != null,
		},
	);
	const focusedStop = createResource<StopFile | null>(
		async (signal) => {
			const id = focusedStopId;
			return id ? getStop(id, { signal }) : null;
		},
		{
			key: () => focusedStopId,
			enabled: () => focusedStopId != null,
		},
	);
	const routeList = $derived(
		selectedRouteIds.length === 0
			? []
			: (selectedRoutes.data ?? []).filter((route) => selectedRouteIds.includes(route.id)),
	);
	const selectedRouteLineId = $derived.by<string | null>(() => {
		if (selected?.kind === 'route') return selected.id;
		if (selected?.kind === 'vehicle') {
			const route = live.index.byVehicleId.get(selected.id)?.route ?? null;
			return route != null && filters.routes.has(route) ? route : null;
		}
		return null;
	});
	const selectedVehicleRoute = $derived.by<RouteFile | null>(() => {
		if (selected?.kind !== 'vehicle') return null;
		const focus = focusedRoute.data;
		return focus && focus.id === selectedRouteLineId ? focus : null;
	});
	const routeLineRoutes = $derived.by<RouteFile[]>(() => {
		const out = [...routeList];
		const vehicleRoute = selectedVehicleRoute;
		if (vehicleRoute && !out.some((route) => route.id === vehicleRoute.id)) {
			out.push(vehicleRoute);
		}
		return out;
	});
	const contextRoutes = $derived.by<RouteFile[]>(() => {
		const out = [...routeList];
		const focus = focusedRoute.data;
		if (focus && !out.some((route) => route.id === focus.id)) out.push(focus);
		return out;
	});
	const contextStopFiles = $derived(focusedStop.data ? [focusedStop.data] : []);
	const liveEdgeState = $derived.by<'unavailable' | 'no-vehicles' | null>(() => {
		const vehicles = live.familyStates.vehicles;
		if (vehicles.phase === 'failed' && vehicles.retainedGeneration == null) return 'unavailable';
		if (
			live.vehicles != null &&
			!live.vehiclesIsStale &&
			(live.vehicles.vehicles?.length ?? 0) === 0
		) {
			return 'no-vehicles';
		}
		return null;
	});
	const liveEdgeMessage = $derived(
		liveEdgeState === 'unavailable'
			? t.liveUnavailable
			: liveEdgeState === 'no-vehicles'
				? t.liveNoVehicles
				: null,
	);

	const availableAlerts = $derived(alertsAvailable ? (live.alerts?.alerts ?? null) : null);
	const alertList = $derived(availableAlerts ?? []);
	const alertEntitySets = $derived(buildAlertEntitySets(alertList));
	const alertVehicleIds = $derived.by(() => {
		const ids = new SvelteSet<string>();
		for (const vehicle of live.vehicles?.vehicles ?? []) {
			if (vehicleHasAlert(vehicle, alertEntitySets)) ids.add(vehicle.id);
		}
		return ids;
	});
	const selectedVehicleId = $derived(selected?.kind === 'vehicle' ? selected.id : null);
	const selectedStopId = $derived(selected?.kind === 'stop' ? selected.id : null);
	const selectedRouteLine = $derived(
		selected?.kind === 'route'
			? {
					id: selected.id,
					direction: selected.direction ?? null,
					variantKey: selected.variantKey ?? null,
				}
			: selected?.kind === 'vehicle' && selectedRouteLineId != null
				? {
						id: selectedRouteLineId,
						direction: null,
						variantKey: null,
					}
				: null,
	);
	const departuresAvailable = $derived(live.familyStates.departures.retainedGeneration != null);
	const resolvedSelectedDetail = $derived(
		resolveMapSelection(selected, {
			locale,
			timeZone: manifest.tz,
			index: live.index,
			stops: stopList,
			routes: contextRoutes,
			stopFiles: contextStopFiles,
			alerts: availableAlerts,
			departuresAvailable,
		}),
	);
	const hoverPeek = $derived(
		resolveMapHoverPeek(hovered, {
			locale,
			index: live.index,
			stops: stopList,
			routesIndex: routesIndex.data?.routes ?? [],
			clock,
			alerts: availableAlerts,
			departuresAvailable,
			hoverRoute:
				hovered?.kind === 'route' && focusedRoute.data?.id === hovered.id
					? focusedRoute.data
					: null,
		}),
	);
	const vehicleSelectionGrace = createSelectionGrace<MapSelectionDetailModel>();
	const vehicleGraceState = $derived.by(() =>
		vehicleSelectionGrace.update({
			selection: selected?.kind === 'vehicle' ? { kind: 'vehicle', id: selected.id } : null,
			resolvedDetail: resolvedSelectedDetail?.kind === 'vehicle' ? resolvedSelectedDetail : null,
			vehicles: live.familyStates.vehicles,
		}),
	);
	const selectedDetail = $derived(
		selected?.kind === 'vehicle' ? vehicleGraceState.detail : resolvedSelectedDetail,
	);
	const selectionPresence = $derived(
		selected?.kind === 'vehicle'
			? vehicleGraceState.presence
			: selectedDetail
				? 'present'
				: selected
					? 'loading'
					: 'gone',
	);
	const selectionSourceHealth = $derived(
		selected?.kind === 'vehicle' ? vehicleGraceState.sourceHealth : 'ok',
	);
	const liveDegraded = $derived(
		Object.values(live.familyStates).some(
			(family) => family.active && (family.phase === 'failed' || family.consecutiveFailures > 0),
		),
	);
	const selectedFamilyFailureMessage = $derived.by<string | null>(() => {
		if (!selected) return null;
		const candidates =
			selected.kind === 'vehicle'
				? ([
						['vehicles', t.familyVehicles],
						['trips', t.familyTrips],
						['alerts', t.familyAlerts],
					] as const)
				: selected.kind === 'stop'
					? ([
							['departures', t.familyDepartures],
							['vehicles', t.familyVehicles],
							['alerts', t.familyAlerts],
						] as const)
					: ([
							['vehicles', t.familyVehicles],
							['alerts', t.familyAlerts],
						] as const);
		for (const [family, label] of candidates) {
			const truth = live.familyStates[family];
			if (truth.active && (truth.phase === 'failed' || truth.consecutiveFailures > 0)) {
				return t.selectedFamilyFailure(label, truth.retainedGeneration != null);
			}
		}
		return null;
	});
	const selectedVehicleAbsence = $derived(vehicleAbsence(selectedDetail, clock.serverNow));
	const detailSurfaceKey = $derived(
		selectedDetail ? `${selectedDetail.kind}:${selectedDetail.id}` : 'empty',
	);
	const SELECTION_WRITE = { authority: 'selection', ownership: 'claim-new' } as const;
	function addSelectionFilter(selection: MapSelection): void {
		const chips: Chip[] = [{ kind: selection.kind, value: selection.id }];
		if (selection.kind === 'vehicle') {
			const route = live.index.byVehicleId.get(selection.id)?.route;
			if (route) chips.push({ kind: 'route', value: route });
		}
		filters.applyChips(chips, SELECTION_WRITE);
	}

	function commitPickedSelection(next: MapSelection): void {
		addSelectionFilter(next);
		selectionController.selectPicked(next);
	}

	function closeDetail(): void {
		filters.clearSelectionOwned();
		selectionController.close();
	}

	function selectFromDetail(next: MapSelection): void {
		selectionController.selectFromDetail(next);
	}

	function goBackDetail(): void {
		selectionController.goBack();
	}

	function applyDetailFilter(chip: Chip): void {
		switch (chip.kind) {
			case 'route':
				filters.addRoute(chip.value);
				break;
			case 'stop':
				filters.addStop(chip.value);
				break;
			case 'trip':
				filters.addTrip(chip.value);
				break;
			case 'vehicle':
				filters.addVehicle(chip.value);
				break;
			case 'status':
				filters.toggleStatus(chip.value);
				break;
			case 'occupancy':
				filters.toggleOccupancy(chip.value);
				break;
			case 'entity':
				filters.toggleEntity(chip.value);
				break;
			case 'alert':
				filters.toggleAlert(chip.value);
				break;
			case 'grain':
				filters.setGrain(undefined);
				break;
			case 'window':
				filters.setWindow(undefined);
				break;
		}
	}

	function selectAlertRelated(alert: Alert): void {
		const chips: Chip[] = [{ kind: 'alert', value: 'has_alert' }];
		for (const value of alert.routes ?? []) chips.push({ kind: 'route', value });
		for (const value of alert.stops ?? []) chips.push({ kind: 'stop', value });
		filters.applyChips(chips, SELECTION_WRITE);
		const firstStop = alert.stops?.[0];
		const firstRoute = alert.routes?.[0];
		if (firstStop) {
			selectFromDetail({ kind: 'stop', id: firstStop });
		} else if (firstRoute) {
			selectFromDetail({ kind: 'route', id: firstRoute });
		}
	}

	function waitingForSelectedDetail(): boolean {
		if (!selected) return false;
		if (selected.kind === 'route' && focusedRouteId === selected.id) {
			return focusedRoute.loading || !focusedRoute.settled;
		}
		if (selected.kind === 'stop') {
			return stops.loading || !stops.settled;
		}
		return false;
	}

	$effect(() => {
		if (!detailOpen) return;
		if (selected && !selectedDetail) {
			if (selected.kind === 'vehicle' && vehicleGraceState.presence !== 'gone') return;
			if (waitingForSelectedDetail()) return;
			closeDetail();
		}
	});

	function focusReady(focus: MapFocus): boolean {
		return isMapFocusReady(focus, {
			stopsSettled: stops.settled,
			vehiclesPhase: live.familyStates.vehicles.phase,
			selectedRouteIds,
			selectedRoutesSettled: selectedRoutes.settled,
			focusedRouteId,
			focusedRouteSettled: focusedRoute.settled,
		});
	}
	return {
		get selected() {
			return selected;
		},
		get hovered() {
			return hovered;
		},
		get stack() {
			return selectionController.stack;
		},
		get detailOpen() {
			return detailOpen;
		},
		set detailOpen(next: boolean) {
			if (next) selectionController.detailOpen = true;
			else closeDetail();
		},
		get detail() {
			return selectedDetail;
		},
		get presence() {
			return selectionPresence;
		},
		get sourceHealth() {
			return selectionSourceHealth;
		},
		get vehicleAbsence() {
			return selectedVehicleAbsence;
		},
		get surfaceKey() {
			return detailSurfaceKey;
		},
		get hoverPeek() {
			return hoverPeek;
		},
		get stops() {
			return stopList;
		},
		get routesIndex() {
			return routesIndex.data?.routes ?? [];
		},
		get routeList() {
			return routeList;
		},
		get routeLineRoutes() {
			return routeLineRoutes;
		},
		get loadedRoutes() {
			return [...(selectedRoutes.data ?? []), focusedRoute.data];
		},
		get selectedRouteLine() {
			return selectedRouteLine;
		},
		get selectedVehicleId() {
			return selectedVehicleId;
		},
		get selectedStopId() {
			return selectedStopId;
		},
		get alertVehicleIds() {
			return alertVehicleIds;
		},
		get alertStopIds() {
			return alertEntitySets.stops;
		},
		get liveEdgeState() {
			return liveEdgeState;
		},
		get liveEdgeMessage() {
			return liveEdgeMessage;
		},
		get liveDegraded() {
			return liveDegraded;
		},
		get failureMessage() {
			return selectedFamilyFailureMessage;
		},
		select(next: MapSelection, source: 'pick' | 'detail') {
			if (source === 'pick') commitPickedSelection(next);
			else selectFromDetail(next);
		},
		back: goBackDetail,
		close: closeDetail,
		setHovered: selectionController.setHovered,
		applyFilter: applyDetailFilter,
		selectAlert: selectAlertRelated,
		focusReady,
	};
}

export type MapSelectionSession = ReturnType<typeof createMapSelectionSession>;
export type {
	MapSelection,
	MapSelectionDetail,
	MapStopRef,
	RouteMapDetail,
	StopMapDetail,
	VehicleMapDetail,
} from './selectionSession/mapSelection';
export type {
	SelectionPresence,
	SelectionSourceHealth,
} from './selectionSession/selectionGrace.svelte';
