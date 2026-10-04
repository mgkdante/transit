<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import type { Map as MapLibreMap } from 'maplibre-gl';
	import type { MapStageFailure } from '$lib/components/map/MapStage.svelte';
	import { getLocale, type Locale } from '$lib/i18n';
	import { themeStore } from '$lib/stores';
	import { layout, isDesktopViewport } from '$lib/nav';
	import { StateNotice } from '$lib/components/edge';
	import { createLiveStore } from '$lib/v1/live/store.svelte';
	import { getV1Context } from '$lib/v1/boot';
	import { getBasemap } from '$lib/v1/repositories/basemap';
	import {
		getRoute,
		getRoutesIndex,
		getStop,
		getStopsIndexSlim,
	} from '$lib/v1/repositories/static';
	import type { RouteFile, StopFile, SlimStopEntry } from '$lib/v1';
	import type { Alert } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import { createFilterStore, fromSearchParams, type Chip } from '$lib/filters';
	import { nearTargetFromSearchParams } from '$lib/search/mapNear';
	import { parseMapFocus } from '$lib/search/mapFocus';
	import { RightPanel } from '$lib/components/shell';
	import {
		MapStage,
		nearestStops,
		liveTtlS,
		type WithDistance,
		type FixResolver,
	} from '$lib/components/map';
	import { createShapeCacheManager } from './mapShapeCache';
	import { vehicleAbsence } from './vehicleAbsence';
	import { sharedClock, motionMode } from '$lib/stores';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import MapFilters from './MapFilters.svelte';
	import MapMotionControl from './MapMotionControl.svelte';
	import MapSelectionDetail from './MapSelectionDetail.svelte';
	import MapSurfaceCanvasLayer from './MapSurfaceCanvasLayer.svelte';
	import MapOverlayChrome from './MapOverlayChrome.svelte';
	import MapDetailOverlay from './MapDetailOverlay.svelte';
	import MapMobileDetailSheet from './MapMobileDetailSheet.svelte';
	import { zoomForNearMePrecision } from './mapGeo';
	import { focusCoordinate, fitRouteBounds } from './mapCamera';
	import {
		buildNearTargetSearch,
		clearNearTargetSearch,
		buildFocusClearSearch,
	} from './mapUrlSync';
	import { motionFeedAnimate } from './motionFeed';
	import { nearTargetKey } from './mapNearMe';
	import { createMapNearMeController, type NearMeOrigin } from './mapNearMeController.svelte';
	import { createMapFocusController } from './mapFocusController.svelte';
	import { isMapFocusReady } from './mapFocusReadiness';
	import { createMapUrlCoordinator, MAP_URL_REWRITE } from './mapUrlCoordinator';
	import { createMapSelectionController } from './mapSelectionController.svelte';
	import { resolveMapHoverPeek } from './mapHoverPeek';
	import { deriveMapFitPadding, mapCameraFraming } from './mapCameraFraming';
	import { mapCopy } from './map.copy';
	import { publishRailOffset, readStoredDetailPanelWidth } from './mapDetailPanes';
	import { buildAlertEntitySets, vehicleHasAlert } from './mapAlerts';
	import { createMapRuntime, type MapRuntimeFeed } from './mapRuntime.svelte';
	import {
		resolveMapSelection,
		type MapSelection,
		type MapSelectionDetail as MapSelectionDetailModel,
	} from './mapSelection';
	import { createSelectionGrace } from './selectionGrace.svelte';
	import * as ownerCleanup from './mapOwnerCleanup';

	interface Props {
		onready?: () => void;
		onidle?: () => void;
		onrecovering?: () => void;
		onfailure?: (failure: MapStageFailure | null) => void;
	}

	let { onready, onidle, onrecovering, onfailure }: Props = $props();

	const locale: Locale = getLocale();
	const theme = $derived(themeStore.current);
	const v1 = getV1Context();
	const manifest = v1.manifest;
	const t = mapCopy(locale, v1.provider?.labels[locale].city ?? manifest.city ?? manifest.provider);
	const framing = mapCameraFraming(v1);

	let mapWidthPx = $state(1280);

	let isDesktopLayout = $state(isDesktopViewport());
	onMount(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(min-width: 1024px)');
		isDesktopLayout = mql.matches;
		const onChange = (e: MediaQueryListEvent) => {
			isDesktopLayout = e.matches;
		};
		mql.addEventListener('change', onChange);
		return () => releaseMapOwner(() => mql.removeEventListener('change', onChange));
	});

	let detailWidthPx = $state(readStoredDetailPanelWidth());
	let detailCollapsed = $state(false);
	let heroEl = $state<HTMLDivElement | null>(null);
	let detailDragging = $state(false);
	const detailResizeAria = $derived(t.detailResizeLabel);
	const mapFitPadding = $derived(deriveMapFitPadding(isDesktopLayout, mapWidthPx));

	const urlCoordinator = createMapUrlCoordinator($page.url, goto);
	const filters = createFilterStore(
		fromSearchParams($page.url.searchParams),
		urlCoordinator.writeFilters,
	);
	const nearMeController = createMapNearMeController({
		providerId: manifest.provider,
		bbox: manifest.bbox,
		locale,
		goto: urlCoordinator.goto,
		currentUrl: urlCoordinator.currentUrl,
		readTarget: (params) => nearTargetFromSearchParams(params, manifest.bbox),
		targetKey: nearTargetKey,
		buildTargetSearch: buildNearTargetSearch,
		clearTargetSearch: clearNearTargetSearch,
		focusOrigin: focusNearMeOrigin,
		fetch: (input, init) => globalThis.fetch(input, init),
		getGeolocation: () => (typeof navigator === 'undefined' ? null : navigator['geolocation']),
		isSecureContext: () => typeof window === 'undefined' || window.isSecureContext,
		translations: t,
	});
	const focusController = createMapFocusController({
		readFocus: parseMapFocus,
		clearFocus: () => {
			const url = urlCoordinator.currentUrl();
			void urlCoordinator.goto(
				buildFocusClearSearch(url.searchParams, url.pathname),
				MAP_URL_REWRITE,
			);
		},
	});
	type RecoveryCameraIntent =
		| { kind: 'point'; coord: [number, number]; minZoom: number }
		| { kind: 'selection'; selection: MapSelection }
		| { kind: 'url' };
	let recovering = $state(false);
	let recoveryCameraIntent: RecoveryCameraIntent | null = null;
	let recoveryFocusTarget: HTMLElement | null = null;

	let ingestedUrlIdentity = '';
	$effect(() => {
		const url = $page.url;
		const urlIdentity = `${url.pathname}${url.search}`;
		if (urlIdentity === ingestedUrlIdentity) return;
		ingestedUrlIdentity = urlIdentity;
		filters.replaceFromUrl(fromSearchParams(url.searchParams), urlCoordinator.settle(url));
		nearMeController.syncFromUrl(url.searchParams);
		const previousFocus = focusController.pending;
		focusController.syncFromUrl(url.searchParams);
		if (recovering && focusController.pending !== previousFocus) {
			if (focusController.pending) recoveryCameraIntent = { kind: 'url' };
			else if (recoveryCameraIntent?.kind === 'url') recoveryCameraIntent = null;
		}
	});

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

	const live = createLiveStore(manifest, {
		families: ['vehicles', 'alerts'],
	});
	function reportMapCleanupFailure(error: unknown): void {
		ownerCleanup.reportCleanupFailure('MapHero cleanup failed', error);
	}
	function releaseMapOwner(dispose: () => void): void {
		ownerCleanup.releaseWithRetry(dispose, reportMapCleanupFailure);
	}
	$effect(() => () => {
		releaseMapOwner(nearMeController.dispose);
		releaseMapOwner(urlCoordinator.dispose);
	});
	onMount(() => {
		live.start();
		return () => releaseMapOwner(() => live.stop());
	});

	$effect(() => {
		const unsubscribe = sharedClock.subscribe();
		return () => releaseMapOwner(unsubscribe);
	});

	const liveTtl = liveTtlS(manifest.files?.live?.ttl_s);

	let mapFailure = $state<MapStageFailure | null>(null);
	let hasFirstIdle = $state(false);
	const shapeCache = createShapeCacheManager(getRoute);
	const selectionController = createMapSelectionController();
	const runtime = createMapRuntime({
		selection: selectionController,
		readFeed: readMapFeed,
		onpick: selectPickedFeature,
	});
	const map = $derived(runtime.map);
	const selected = $derived(selectionController.selected);
	const selectionStack = $derived(selectionController.stack);
	const hovered = $derived(selectionController.hovered);
	const detailOpen = $derived(selectionController.detailOpen);

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
	const nearbyStops = $derived<WithDistance<SlimStopEntry>[]>(
		nearMeController.origin ? nearestStops(nearMeController.origin, stopList, 5, 1_200) : [],
	);
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
	$effect(() => {
		const routes = [...(selectedRoutes.data ?? []), focusedRoute.data];
		untrack(() => {
			for (const route of routes) if (route) shapeCache.remember(route);
		});
	});
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

	const availableAlerts = $derived(
		v1.provider?.inputs.i3_alerts === false && v1.provider.inputs.service_alerts === false
			? null
			: (live.alerts?.alerts ?? null),
	);
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
			clock: sharedClock,
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
	const selectedVehicleAbsence = $derived(vehicleAbsence(selectedDetail, sharedClock.serverNow));
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

	function selectPickedFeature(next: MapSelection): void {
		commitPickedSelection(next);
		detailCollapsed = false;
		focusSelection(next);
	}

	function closeDetail(): void {
		filters.clearSelectionOwned();
		selectionController.close();
		detailCollapsed = false;
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

	function focusSelection(selection: MapSelection, target: MapLibreMap | null = map): boolean {
		if (recovering) {
			recoveryCameraIntent = { kind: 'selection', selection };
			return true;
		}
		if (selection.kind === 'stop') return focusStop(selection.id, target);
		if (selection.kind === 'vehicle') return focusVehicle(selection.id, target);
		return focusRoute(selection.id, target);
	}

	function focusStop(id: string, target: MapLibreMap | null = map): boolean {
		const stop = stopList.find((s) => s.id === id);
		if (!stop) return false;
		return focusCoordinate(target, [stop.lon, stop.lat], 16);
	}

	function focusVehicle(id: string, target: MapLibreMap | null = map): boolean {
		const vehicle = (live.vehicles?.vehicles ?? []).find((v) => v.id === id);
		if (!vehicle) return false;
		return focusCoordinate(target, [vehicle.lon, vehicle.lat], 16);
	}

	function focusRoute(id: string, target: MapLibreMap | null = map): boolean {
		const route = routeList.find((r) => r.id === id);
		if (!route) return false;
		return fitRouteBounds(target, route);
	}

	$effect(() => {
		const pending = focusController.pending;
		if (recovering || !map || !pending) return;
		if (
			!isMapFocusReady(pending, {
				stopsSettled: stops.settled,
				vehiclesPhase: live.familyStates.vehicles.phase,
				selectedRouteIds,
				selectedRoutesSettled: selectedRoutes.settled,
				focusedRouteId,
				focusedRouteSettled: focusedRoute.settled,
			})
		)
			return;
		focusController.consumeOnce(focusSelection);
	});

	function focusNearMeOrigin(origin: NearMeOrigin): void {
		const coord: [number, number] = [origin.lon, origin.lat];
		const minZoom = zoomForNearMePrecision(origin.precision);
		if (recovering) recoveryCameraIntent = { kind: 'point', coord, minZoom };
		else focusCoordinate(map, coord, minZoom);
	}

	function selectNearbyStop(stop: WithDistance<SlimStopEntry>): void {
		commitPickedSelection({ kind: 'stop', id: stop.id });
		detailCollapsed = false;
		if (recovering)
			recoveryCameraIntent = { kind: 'point', coord: [stop.lon, stop.lat], minZoom: 15 };
		else focusCoordinate(map, [stop.lon, stop.lat], 15);
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

	function onMapReady(m: MapLibreMap, reportSetupFailure?: () => void): void {
		const wasRecovering = recovering;
		hasFirstIdle = false;
		runtime.ready(m, reportSetupFailure);
		if (wasRecovering) {
			recovering = false;
			const intent = recoveryCameraIntent;
			recoveryCameraIntent = null;
			if (intent?.kind === 'point' || intent?.kind === 'selection') {
				if (focusController.pending) focusController.consumeOnce(() => {});
				if (intent.kind === 'point') focusCoordinate(m, intent.coord, intent.minZoom);
				else focusSelection(intent.selection, m);
			}
		} else nearMeController.refocus();
		onready?.();
	}

	function onMapRecovering(): void {
		const focused = document.activeElement;
		const ownedFocus = focused instanceof HTMLElement && heroEl?.contains(focused) ? focused : null;
		recoveryFocusTarget =
			ownedFocus && !ownedFocus.closest('[data-map-runtime]') ? ownedFocus : null;
		ownedFocus?.blur();
		recovering = true;
		recoveryCameraIntent = focusController.pending ? { kind: 'url' } : null;
		onrecovering?.();
	}

	function onMapIdle(): void {
		hasFirstIdle = true;
		const focused = recoveryFocusTarget;
		recoveryFocusTarget = null;
		onidle?.();
		if (focused) {
			void tick().then(() => {
				if (
					!recovering &&
					focused.isConnected &&
					heroEl?.contains(focused) &&
					document.activeElement === document.body &&
					!focused.closest('[inert]')
				) {
					focused.focus({ preventScroll: true });
				}
			});
		}
	}

	function onMapFailure(failure: MapStageFailure | null): void {
		mapFailure = failure;
		onfailure?.(failure);
	}

	$effect(() => {
		const vehicles = live.vehicles?.vehicles ?? [];
		if (motionMode.current !== 'smooth' || vehicles.length === 0) return;
		untrack(() => shapeCache.prefetch(vehicles));
	});

	const shapeFor = shapeCache.shapeFor;

	const fixFor: FixResolver = (id) => {
		const v = live.index.byVehicleId.get(id);
		if (!v) return null;
		return {
			reportedUtc: v.reported_utc,
			updatedUtc: v.updated_utc,
			speedMps: v.speed_kmh != null ? v.speed_kmh / 3.6 : null,
		};
	};

	function readMapFeed(): MapRuntimeFeed {
		const reduceMotion = $prefersReducedMotion;
		const smoothMotion = motionMode.current === 'smooth';
		const animate = hasFirstIdle && motionFeedAnimate({ smoothMotion, reduceMotion });
		const serverNow = untrack(() => sharedClock.serverNow);
		const filter = filters.state;
		const stale = live.vehiclesIsStale;
		const vehicleItems = live.vehicles?.vehicles ?? [];
		const vehicleTickKey = live.vehiclesGeneratedUtc;
		return {
			routes: {
				items: routeLineRoutes,
				selected: selectedRouteLine,
			},
			vehicles: {
				items: vehicleItems,
				filter,
				alertIds: alertVehicleIds,
				selectedId: selectedVehicleId,
				serverNow,
				ttlS: liveTtl,
				tickKey: vehicleTickKey,
				stale,
				fixFor,
				shapeFor: animate ? shapeFor : undefined,
				serverNowFn: () => untrack(() => sharedClock.serverNowContinuousMs()),
				animate,
			},
			stops: {
				items: stopList,
				filter,
				alertIds: alertEntitySets.stops,
				selectedId: selectedStopId,
			},
			nearTarget: {
				target: nearMeController.origin,
			},
		};
	}

	$effect(() => {
		if (!detailOpen) return;
		if (selected && !selectedDetail) {
			if (selected.kind === 'vehicle' && vehicleGraceState.presence !== 'gone') return;
			if (waitingForSelectedDetail()) return;
			closeDetail();
		}
	});

	$effect(() => {
		const el = heroEl;
		if (!el) return;
		const open = detailOpen && layout.isDesktop;
		const dispose = publishRailOffset(el, detailWidthPx, open, detailCollapsed, detailDragging);
		return () => releaseMapOwner(dispose);
	});

	function toggleDetailCollapsed(): void {
		detailCollapsed = !detailCollapsed;
	}
</script>

{#snippet mapBody()}
	<MapStage
		class="map-hero-stage"
		basemapLoader={({ signal }) => getBasemap({ signal })}
		{theme}
		center={framing.center}
		bounds={framing.bounds}
		maxBounds={framing.maxBounds}
		fitPadding={mapFitPadding}
		onready={onMapReady}
		onrecovering={onMapRecovering}
		onidle={onMapIdle}
		onstyleload={runtime.styleLoad}
		onthemerepaint={runtime.repaint}
		onerror={onMapFailure}
		onbeforeremove={runtime.release}
		customAttribution={manifest.attribution}
		locale={{
			'Map.Title': t.mapCanvasLabel,
			'AttributionControl.ToggleAttribution': t.attributionToggle,
		}}
		label={t.mapLabel}
	/>
{/snippet}

{#snippet detailPanel()}
	<!-- prettier-ignore --><RightPanel {locale} identity={detailIdentity} footer={detailFooter} surfaceKey={detailSurfaceKey} canGoBack={selectionStack.length > 0} onback={goBackDetail} onclose={closeDetail} collapsed={detailCollapsed} ontogglecollapse={toggleDetailCollapsed} resizable>
		{#if selectedDetail}
			<MapSelectionDetail
				detail={selectedDetail}
				{locale}
				timeZone={v1.manifest.tz}
				notReporting={selectedVehicleAbsence}
				{selectionPresence}
				{selectionSourceHealth}
				onrefresh={live.refresh}
				onselect={selectFromDetail}
				onpreview={(next) => void selectionController.setHovered(next)}
				onfilter={applyDetailFilter}
				onalertselect={selectAlertRelated}
			/>
		{/if}
	</RightPanel>
{/snippet}

{#snippet detailIdentity()}<!-- prettier-ignore --><MapSelectionDetail detail={selectedDetail} {locale} presentation="identity" />{/snippet}
{#snippet detailFooter()}<!-- prettier-ignore --><MapSelectionDetail detail={selectedDetail} {locale} presentation="action" onfilter={applyDetailFilter} />{/snippet}

{#snippet motionHeader(collapsed: boolean)}
	<MapMotionControl {locale} copy={t} {collapsed} />
{/snippet}
{#snippet mapControls(opts?: { collapsible?: boolean })}
	<MapFilters
		store={filters}
		{locale}
		routes={routesIndex.data?.routes ?? []}
		stops={stops.data?.stops ?? []}
		collapsible={opts?.collapsible ?? true}
		controlsMode={true}
		header={motionHeader}
	/>
{/snippet}

{#snippet mapRetry()}
	{#if mapFailure}
		<button type="button" class="map-stage-retry" onclick={() => void mapFailure?.retry()}>
			{t.mapRetry}
		</button>
	{/if}
{/snippet}

{#snippet mapSurface()}
	<div class="map-surface">
		<MapSurfaceCanvasLayer {mapBody} />

		{#if mapFailure}
			<div class="map-stage-error">
				<StateNotice
					title={t.mapErrorTitle}
					body={t.mapErrorBody}
					glyph="!"
					tone="error"
					presentation="card"
					role="alert"
					ariaLive="assertive"
					action={mapRetry}
				/>
			</div>
		{:else}
			<MapOverlayChrome
				{locale}
				{t}
				generatedUtc={live.generatedUtc}
				ageSeconds={live.ageSeconds}
				isStale={live.isStale}
				degraded={liveDegraded}
				{selectedFamilyFailureMessage}
				bind:nearMeOpen={nearMeController.open}
				bind:nearMeQuery={nearMeController.query}
				nearMeLoading={nearMeController.loading}
				nearMeError={nearMeController.error}
				nearMeOrigin={nearMeController.origin}
				{nearbyStops}
				onuselocation={nearMeController.useLocation}
				onsearch={nearMeController.search}
				onsuggestion={nearMeController.selectSuggestion}
				onstopselect={selectNearbyStop}
				onclear={nearMeController.clear}
				isDesktop={layout.isDesktop}
				filtersStore={filters}
				{detailOpen}
				{liveEdgeState}
				{liveEdgeMessage}
				{hoverPeek}
				controls={mapControls}
			/>
		{/if}
	</div>
{/snippet}

<div
	class="map-hero"
	data-selection-presence={selectionPresence}
	data-selection-source-health={selectionSourceHealth}
	data-motion-stale={live.vehiclesIsStale}
	data-motion-tick-key={runtime.processedMotion?.tickKey}
	data-motion-vehicle-count={runtime.processedMotion?.vehicleCount}
	bind:this={heroEl}
	bind:clientWidth={mapWidthPx}
>
	{@render mapSurface()}

	{#if layout.isDesktop && detailOpen}
		<MapDetailOverlay
			bind:widthPx={detailWidthPx}
			bind:collapsed={detailCollapsed}
			bind:dragging={detailDragging}
			resizeAria={detailResizeAria}
			{detailPanel}
		/>
	{/if}

	{#if detailOpen && !layout.isDesktop}
		<MapMobileDetailSheet
			bind:open={
				() => selectionController.detailOpen,
				(next) => {
					if (next) selectionController.detailOpen = true;
					else closeDetail();
				}
			}
			{locale}
			identity={detailIdentity}
			timeZone={v1.manifest.tz}
			footer={detailFooter}
			surfaceKey={detailSurfaceKey}
			canGoBack={selectionStack.length > 0}
			onback={goBackDetail}
			{selectedDetail}
			notReporting={selectedVehicleAbsence}
			{selectionPresence}
			{selectionSourceHealth}
			onrefresh={live.refresh}
			onselect={selectFromDetail}
			onpreview={(next) => void selectionController.setHovered(next)}
			onfilter={applyDetailFilter}
			onalertselect={selectAlertRelated}
		/>
	{/if}
</div>

<style>
	.map-hero {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--background);
		--app-right-detail-offset: var(--size-detail-panel);
		--map-detail-offset: 0rem;
		--map-mobile-control-bottom: calc(5.25rem + env(safe-area-inset-bottom, 0px));
		--z-map-behind: -1;
		--z-map-canvas: 1;
		--z-map-popover-behind: 2;
		--z-map-scrim: 5;
		--z-map-overlay: 10;
		--z-map-filter: 12;
		--z-map-banner-content: 13;
		--z-map-detail: 24;
		--z-map-detail-panel: 32;
	}

	.map-surface {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}

	.map-stage-error {
		position: absolute;
		z-index: var(--z-map-detail);
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: color-mix(in srgb, var(--background) 88%, transparent);
	}

	.map-stage-error :global(.state-notice) {
		width: min(100%, 30rem);
	}

	.map-stage-retry {
		min-height: 2.5rem;
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--primary);
		color: var(--primary-foreground);
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}
</style>
