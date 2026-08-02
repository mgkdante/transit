<!--
  MapHero — the citizen-first live vehicle map (Family A, slice-9.3 hero).

  ENCODING DOCTRINE (one colour per entity, state→filter): buses render in ONE
  calm brand orange as a single directional kite sprite that rotates by bearing;
  stops are reddish-orange diamonds, zoom-gated so the 8,986-stop catalogue never
  blankets the city. No status/crowding colour by default — that lives in the
  combinable filter, which repaints matched subsets in their state colour and
  hides non-matches. Routes draw on-demand (per-route geometry; no bulk file)
  when filtered/selected — next.

  Composes the map kit + live store: MapStage owns the GL canvas; once ready we
  bake sprites and add the stops layer (under) + the vehicle layers (over). A
  live store polls every 30s; an $effect feeds vehicles + the stop catalogue into
  the layers and dims on stale.

  DOCTRINE: map entities may use --primary by operator decision. The basemap
  rides the brand surface palette; every mark rides a token, no hardcoded hex.
-->
<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { navigating, page } from '$app/stores';
	import { goto } from '$app/navigation';
	import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
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
		createVehicleMotionController,
		nearestStops,
		liveTtlS,
		type WithDistance,
		type VehicleMotionController,
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
	import { createMapEmphasisController } from './mapEmphasisController.svelte';
	import { resolveMapHoverPeek } from './mapHoverPeek';
	import {
		deriveMapFitPadding,
		ISLAND_FIT_BOUNDS,
		MAP_MAX_BOUNDS,
		mapInitialCenter,
	} from './mapCameraFraming';
	import { copy as MAP_COPY } from './map.copy';
	import { publishRailOffset, readStoredDetailPanelWidth } from './mapDetailPanes';
	import { buildAlertEntitySets, vehicleHasAlert } from './mapAlerts';
	import {
		installMapInteractions,
		MAP_LAYER_MODULES,
		PICKABLE_MAP_LAYERS,
		retintMapLayers,
		type MapLayerFeedContext,
	} from './mapLayerModules';
	import { pickMapSelection } from './mapPicking';
	import {
		resolveMapSelection,
		type MapSelection,
		type MapSelectionDetail as MapSelectionDetailModel,
	} from './mapSelection';
	import { createSelectionGrace } from './selectionGrace.svelte';
	import { attachMapDetailNavigationRecovery } from './mapDetailNavigationRecovery';

	const locale: Locale = getLocale();
	const t = $derived(MAP_COPY[locale]);
	const theme = $derived(themeStore.current);
	const v1 = getV1Context();
	const manifest = v1.manifest;

	// Hero width — window-reactive ONLY. The fit-padding fraction math runs off the
	// WHOLE-HERO clientWidth. The map is full-bleed (it fills the hero), and every
	// panel OVERLAYS it (absolute), so dragging or collapsing a panel never changes
	// the hero width — the fit padding stays STABLE and MapStage never re-fits for
	// a panel interaction. A genuine viewport resize changes mapWidthPx and re-derives
	// the padding. Seeded with a desktop default so the fraction applies before the
	// first clientWidth measurement (a 0 here would fall back to the wide fit).
	let mapWidthPx = $state(1280);

	// Hydration-safe `isDesktopLayout` snapshot for the CAMERA-AFFECTING mapFitPadding.
	// Seeded up front from matchMedia (`isDesktopViewport()`, SSR-safe → false on the
	// server) and refreshed only on a GENUINE viewport resize in onMount — NOT off the
	// shared `layout.isDesktop` store. The store flips false→true during hydration (it
	// reads `false` on the server), and the map's fitPadding effect re-runs fitBounds on
	// any padding change, so deriving the padding off that store would re-fit and SHIFT
	// the camera on first paint. A matchMedia read at init gives the real client value;
	// mapFitPadding still re-derives on real width or breakpoint changes. The store
	// drives only the non-camera chrome branches below (hover peek, the detail pane
	// gate, motion control).
	let isDesktopLayout = $state(isDesktopViewport());
	onMount(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(min-width: 1024px)');
		// Confirm the layout post-mount (covers any SSR/init skew) and keep it live for
		// real resizes across the breakpoint. A `change` only fires on an actual
		// viewport crossing, never on the hydration pass, so the camera is not re-fit
		// during load.
		isDesktopLayout = mql.matches;
		const onChange = (e: MediaQueryListEvent) => {
			isDesktopLayout = e.matches;
		};
		mql.addEventListener('change', onChange);
		return () => mql.removeEventListener('change', onChange);
	});

	// Right DETAIL panel — an absolute OVERLAY anchored flush to the map's right edge
	// (NOT a paneforge pane). Its WIDTH is the `--app-right-detail-offset` CSS var on
	// .map-hero; dragging the panel's left-edge handle writes a live clamped px width
	// into that var and we persist the chosen width (transit:detail-panel-width), so
	// the layout sticks across reloads. COLLAPSING slides the overlay OFF the right
	// edge (data-detail-collapsed on .map-hero). Because the panel is absolute, none
	// of this touches the map canvas — the map sizes off its own container, never the
	// panel width, so dragging/collapsing the detail can NEVER resize the map.
	let detailWidthPx = $state(readStoredDetailPanelWidth());
	let detailCollapsed = $state(false);
	let heroEl = $state<HTMLDivElement | null>(null);
	let detailDragging = $state(false);
	const detailResizeAria = $derived(t.detailResizeLabel);
	// Reads the hydration-safe snapshot, never the hydration-flipping layout store.
	const mapFitPadding = $derived(deriveMapFitPadding(isDesktopLayout, mapWidthPx));

	// URL-DRIVEN filter state — the reusable spine. Seeded from the URL so a reload
	// (or a deep-link like /map?status=late) restores the exact view; every toggle
	// pushes the canonical query via goto (replaceState so the map view isn't
	// disrupted + back/forward stay clean). One map, deep-linkable from anywhere.
	// Every URL write here is an in-place rewrite: keep the map view (noScroll),
	// the user's focus, and a clean back/forward stack.
	const urlCoordinator = createMapUrlCoordinator(
		$page.url,
		goto,
		() => $page.state as Readonly<Record<string, unknown>>,
	);
	onDestroy(() => urlCoordinator.dispose());
	const filters = createFilterStore(
		fromSearchParams($page.url.searchParams),
		urlCoordinator.writeFilters,
	);
	const nearMeController = createMapNearMeController({
		goto: urlCoordinator.goto,
		currentUrl: urlCoordinator.currentUrl,
		readTarget: nearTargetFromSearchParams,
		targetKey: nearTargetKey,
		buildTargetSearch: buildNearTargetSearch,
		clearTargetSearch: clearNearTargetSearch,
		focusOrigin: focusNearMeOrigin,
		fetch: (input) => globalThis.fetch(input),
		getGeolocation: () => (typeof navigator === 'undefined' ? null : navigator['geolocation']),
		isSecureContext: () => typeof window === 'undefined' || window.isSecureContext,
		translations: MAP_COPY[locale],
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

	const mapDetailNavigationRecovery = attachMapDetailNavigationRecovery({
		currentIntent: urlCoordinator.currentIntent,
		goto: urlCoordinator.goto,
	});
	$effect(() => mapDetailNavigationRecovery.observe($navigating?.to?.url ?? null));

	let observedPageUrl: URL | null = null;
	let ingestedUrlIdentity = '';
	$effect(() => {
		const url = $page.url;
		if (url === observedPageUrl) return;
		observedPageUrl = url;
		const urlIdentity = `${url.pathname}${url.search}`;
		const mapSettlement = mapDetailNavigationRecovery.settle(
			url,
			urlCoordinator.settle,
			$navigating?.to?.url ?? null,
			$page.state,
		);
		if (mapSettlement === 'recovered') return;
		if (urlIdentity === ingestedUrlIdentity) return;
		ingestedUrlIdentity = urlIdentity;
		filters.replaceFromUrl(fromSearchParams(url.searchParams), mapSettlement);
		nearMeController.syncFromUrl(url.searchParams);
		focusController.syncFromUrl(url.searchParams);
	});

	// Basemap pointer (hosted Montréal PMTiles), or null → minimal-dark fallback.
	// NOT a createResource here: MapStage resolves it via `basemapLoader` at mount
	// (B2 hot first paint) so it is baked into the constructor style — a resource
	// that settled AFTER mount used to flip basemap.data null→file and trigger a
	// full setStyle wipe (the flicker). getBasemap() is passed straight to the stage.
	// Static stop catalogue (8,986 stops) for the stops layer + (later) near-me.
	// Slim stops-index fast-path (§C8 item 3): the map only needs {id,name,lat,lon,code}
	// (it plots points, labels them, and fetches the FULL per-stop record on click), so
	// it loads the server-projected slim index instead of the 1.15 MB full catalogue.
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

	// Live tier — one store for this surface (v1 context booted before mount).
	const live = createLiveStore(manifest, {
		families: ['vehicles', 'alerts'],
	});
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// Keep one shared server-time tick alive for map freshness and relative-time copy.
	$effect(() => sharedClock.subscribe());

	$effect(() => () => {
		untrack(() => vehicleMotion)?.destroy();
		for (const dispose of interactionDisposers) dispose();
	});

	const liveTtl = liveTtlS(manifest.files?.live?.ttl_s);

	// MapLibre is an opaque lifecycle owner. Track handle replacement, never proxy
	// the instance itself; teardown callbacks must compare and release the exact map.
	let map = $state.raw<MapLibreMap | null>(null);
	let mapFailure = $state<{ readonly retry: () => Promise<void> } | null>(null);
	let vehicleMotion = $state<VehicleMotionController | null>(null);
	let vehicleMotionMap: MapLibreMap | null = null;

	const shapeCache = createShapeCacheManager(getRoute);

	let layerRevision = $state(0);
	let interactionsMap: MapLibreMap | null = null;
	let interactionDisposers: readonly (() => void)[] = [];
	const selectionController = createMapSelectionController();
	const emphasisController = createMapEmphasisController(selectionController);
	const selected = $derived(selectionController.selected);
	const selectionStack = $derived(selectionController.stack);
	const hovered = $derived(selectionController.hovered);
	const detailOpen = $derived(selectionController.detailOpen);
	$effect(() => () => untrack(() => emphasisController.clear()));

	function releaseMapOwners(m: MapLibreMap): void {
		if (map !== m) return;
		const motion = vehicleMotion;
		const disposers = interactionDisposers;
		vehicleMotion = null;
		vehicleMotionMap = null;
		interactionDisposers = [];
		interactionsMap = null;
		map = null;

		const releaseErrors: unknown[] = [];
		try {
			motion?.destroy();
		} catch (error) {
			releaseErrors.push(error);
		}
		for (const dispose of disposers) {
			try {
				dispose();
			} catch (error) {
				releaseErrors.push(error);
			}
		}
		try {
			emphasisController.clear(m);
		} catch (error) {
			releaseErrors.push(error);
		}
		if (releaseErrors.length > 0) throw releaseErrors[0];
	}

	// Selection-scoped live families are ref-counted leases keyed strictly on the
	// committed selection. Hover never activates a family or restarts polling.
	$effect(() => {
		if (selected?.kind === 'vehicle') return live.subscribeFamilies(['trips']);
		if (selected?.kind === 'stop') return live.subscribeFamilies(['departures']);
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
	// The route geometry for a selected vehicle, loaded on-demand the same way
	// `focusedRoute` resolves it (getRoute(id) via the focusedRouteId lookup). We
	// reuse focusedRoute.data when it already holds the selected vehicle's route so
	// the line can actually render; the filter-selected routes still always draw.
	const selectedVehicleRoute = $derived.by<RouteFile | null>(() => {
		if (selected?.kind !== 'vehicle') return null;
		const focus = focusedRoute.data;
		return focus && focus.id === selectedRouteLineId ? focus : null;
	});
	// Routes whose linework is drawn: the filter-selected routes PLUS the selected
	// vehicle's route (so its highlight has geometry to thicken). Selecting a route
	// directly already adds it to filters → routeList, so no extra merge needed there.
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
	// Live-feed edge state, surfaced as a small non-blocking floating notice (the
	// basemap, the stop catalogue, and near-me all stay usable behind it). We never
	// wrap the GL canvas in a boundary — that would blank the whole surface, which is
	// the wrong loading model here (the map mounts immediately and repaints).
	//   · 'unavailable' — the live feed could not be reached AND no build has ever
	//     loaded (cold-start-down). With a prior build, the freshness pill's stale
	//     verdict already carries the signal, so we do not double up.
	//   · 'no-vehicles' — a build loaded fine + is fresh, but reports zero vehicles
	//     to plot (e.g. overnight, or a partial feed). Honest "nothing to show" beats
	//     a silent empty map.
	// PIPELINE-BLOCKED: upgrading 'no-vehicles' to the inferred reason via
	// $lib/site/serviceWindow.inferAbsenceReason is not actionable web-side. The map spans
	// the WHOLE network (mixed modes + every route), so there is no single first/last window
	// to claim "closed" against here — a network-wide overnight verdict needs a
	// network service-span signal /v1 does not yet publish. The selected-but-silent
	// "last seen N ago" half is also DEFERRED: it needs a per-vehicle report
	// timestamp in /v1, but updated_utc is currently the uniform snapshot capture
	// time (every vehicle shares it), so it can only express global staleness, not
	// one stuck bus.
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

	const alertList = $derived(live.alerts?.alerts ?? []);
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
	// The line to thicken: a directly-selected route honours its picked direction/
	// variant; a selected vehicle lights up its whole route (no direction on a
	// vehicle). Null when the selection bears no route (or the bus has no route id)
	// → no highlight, never a fabricated line.
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
			index: live.index,
			stops: stopList,
			routes: contextRoutes,
			stopFiles: contextStopFiles,
			alerts: live.alerts?.alerts ?? null,
			departuresAvailable,
		}),
	);
	const hoverPeek = $derived(
		resolveMapHoverPeek(hovered, {
			index: live.index,
			stops: stopList,
			routesIndex: routesIndex.data?.routes ?? [],
			clock: sharedClock,
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
	// Per-bus stale-GPS note (pure module): { ageS } when a focused VEHICLE detail's
	// OWN fix is past the cutoff, else null. Reads sharedClock.serverNow so the note
	// appears/refreshes as a bus crosses the cutoff between polls.
	const selectedVehicleAbsence = $derived(vehicleAbsence(selectedDetail, sharedClock.serverNow));
	const detailSurfaceKey = $derived(
		selectedDetail ? `${selectedDetail.kind}:${selectedDetail.id}` : 'empty',
	);
	function clearHover(m: MapLibreMap): void {
		selectionController.setHovered(null);
		m.getCanvas().style.cursor = '';
	}

	function pickSelectionAt(m: MapLibreMap, e: MapMouseEvent): MapSelection | null {
		const layers = PICKABLE_MAP_LAYERS.filter((layer) => m.getLayer(layer));
		if (layers.length === 0) return null;
		return pickMapSelection(m.queryRenderedFeatures(e.point, { layers }));
	}

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

	function selectPickedFeature(m: MapLibreMap, e: MapMouseEvent): void {
		const next = pickSelectionAt(m, e);
		if (!next) return;
		commitPickedSelection(next);
		// A fresh pick always shows its detail: if the panel was sitting collapsed in
		// the icon strip, expand it so the new selection is visible, never stranded.
		detailCollapsed = false;
		// Zoom to whatever was clicked, same as a search pick (data is already
		// loaded — it's on the map). Point entities centre + zoom in; a route frames
		// its linework.
		focusSelection(next);
	}

	function hoverPickedFeature(m: MapLibreMap, e: MapMouseEvent): void {
		const next = pickSelectionAt(m, e);
		if (!selectionController.setHovered(next)) return;
		m.getCanvas().style.cursor = next ? 'pointer' : '';
	}

	function closeDetail(): void {
		filters.clearSelectionOwned();
		selectionController.close();
		// Re-open the panel expanded next time: a closed panel should not remember a
		// collapsed strip (that would re-open as an empty rail with no obvious content).
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

	// Zoom to a selection directly (click path) — data is already loaded, so no
	// pending/retry needed. Shared with the URL-driven focus resolver below.
	function focusSelection(selection: MapSelection): boolean {
		if (selection.kind === 'stop') return focusStop(selection.id);
		if (selection.kind === 'vehicle') return focusVehicle(selection.id);
		return focusRoute(selection.id);
	}

	function focusStop(id: string): boolean {
		const stop = stopList.find((s) => s.id === id);
		if (!stop) return false;
		return focusCoordinate(map, [stop.lon, stop.lat], 16);
	}

	function focusVehicle(id: string): boolean {
		const vehicle = (live.vehicles?.vehicles ?? []).find((v) => v.id === id);
		if (!vehicle) return false;
		return focusCoordinate(map, [vehicle.lon, vehicle.lat], 16);
	}

	function focusRoute(id: string): boolean {
		const route = routeList.find((r) => r.id === id);
		if (!route) return false;
		return fitRouteBounds(map, route);
	}

	// Resolve the pending focus once the map AND the entity's data are available;
	// reads the kind's reactive source so it re-runs when that data loads, then
	// pans/fits and strips the param so it fires exactly once.
	$effect(() => {
		const pending = focusController.pending;
		if (!map || !pending) return;
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
		focusCoordinate(map, [origin.lon, origin.lat], zoomForNearMePrecision(origin.precision));
	}

	function selectNearbyStop(stop: WithDistance<SlimStopEntry>): void {
		commitPickedSelection({ kind: 'stop', id: stop.id });
		// A fresh pick always shows its detail: expand the panel if it was collapsed.
		detailCollapsed = false;
		focusCoordinate(map, [stop.lon, stop.lat], 15);
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

	function ensureMapInteractions(m: MapLibreMap): void {
		if (interactionsMap === m) return;
		for (const dispose of interactionDisposers) dispose();
		interactionsMap = m;
		interactionDisposers = installMapInteractions(m, {
			click: (event) => selectPickedFeature(m, event),
			mousemove: (event) => hoverPickedFeature(m, event),
			mouseleave: () => clearHover(m),
		});
	}
	function ensureVehicleMotion(m: MapLibreMap): void {
		if (vehicleMotionMap !== m) {
			vehicleMotion?.destroy();
			vehicleMotion = createVehicleMotionController(m);
			vehicleMotionMap = m;
		}
	}

	function installMapLayers(m: MapLibreMap): void {
		// Prepare every module before installing any layer. bakeVehicleSprites owns
		// STOP_ICON even though the stops module consumes it, so a per-module
		// prepare/install loop would install stops before that shared asset exists.

		// SF deliberately preserves append order. firstSymbolLayerId() is available
		// for the owner-parked visual flip, but this slice passes no anchor.
		const beforeId: string | undefined = undefined;
		retintMapLayers(m, beforeId);

		// Controller identity belongs to this MapHero instance, not the static
		// registry. Reuse it across style loads of the same map.
		ensureVehicleMotion(m);
		ensureMapInteractions(m);
		// Bump so the feed effect re-runs and re-pushes the vehicle/stop/route data
		// MapLibre cleared from its custom sources on the style swap.
		layerRevision += 1;
	}

	function onMapReady(m: MapLibreMap): void {
		map = m;
		installMapLayers(m);
		nearMeController.refocus();
	}

	function onMapStyleLoad(m: MapLibreMap): void {
		installMapLayers(m);
	}
	function onMapThemeRepaint(m: MapLibreMap): void {
		retintMapLayers(m);
	}

	// Lazily fetch route shapes for the routes that currently have live buses
	// (deduped). Tracks the vehicles poll + motion toggle (other reads untracked), so
	// raw→smooth fires immediately while filter/hover never re-triggers fetches. The
	// manager owns fetch/dedupe/evict + the per-frame resolver; a resolved shape is
	// picked up by `shapeCache.shapeFor` on the next rAF frame, no re-feed needed.
	$effect(() => {
		const vehicles = live.vehicles?.vehicles ?? [];
		if (motionMode.current !== 'smooth' || vehicles.length === 0) return;
		untrack(() => shapeCache.prefetch(vehicles));
	});

	// Per-vehicle route-shape resolver passed into the motion controller. Returns the
	// cached route-shape variant a vehicle's CURRENT point sits on (least projection
	// error), or null → FREEZE (no shape ⇒ no forward dead-reckoning). Read EACH FRAME
	// by the controller (a cheap cache lookup), so a route shape that resolves
	// mid-flight upgrades the bus from frozen to projected without waiting for a re-feed.
	const shapeFor = shapeCache.shapeFor;

	// Per-vehicle FORWARD-projection inputs the painted feature does not carry: the
	// bus's OWN fix time (reported_utc, nullable → updated_utc fallback) and its
	// speed in m/s (speed_kmh ÷ 3.6). Looked up from the live index by id; null for
	// an unknown bus → the controller freezes it (never dead-reckons on guessed
	// data).
	const fixFor: FixResolver = (id) => {
		const v = live.index.byVehicleId.get(id);
		if (!v) return null;
		return {
			reportedUtc: v.reported_utc,
			updatedUtc: v.updated_utc,
			speedMps: v.speed_kmh != null ? v.speed_kmh / 3.6 : null,
		};
	};

	// Feed every registered module from one synchronous, non-retained context.
	// Forward projection is CLOCK-DRIVEN inside the controller's rAF loop, so this
	// effect re-feeds files/filter/selection changes but not the per-second clock.
	$effect(() => {
		const m = map;
		// Reading `layerRevision` registers the post-style-swap layer install as an
		// effect dependency, so data is re-fed after MapLibre clears custom sources.
		// (A resolved route shape needs NO re-feed: the controller's per-frame
		// shapeFor reads routeShapeCache directly and upgrades buses on the next frame.)
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		layerRevision;
		if (!m) return;
		const reduceMotion = $prefersReducedMotion;
		// Smooth = forward-projection ("almost real-time"); raw = ping-on-load (snap
		// every feed, no estimation), the honest default. Reading motionMode.current
		// here registers it as an effect dependency so flipping the toggle re-feeds
		// and the controller switches between project and snap without a poll.
		const smoothMotion = motionMode.current === 'smooth';
		const animate = motionFeedAnimate({ smoothMotion, reduceMotion });
		// serverNow read UNTRACKED here so this poll/filter/selection effect is NOT
		// re-run by the per-second clock tick (the controller's rAF loop advances
		// projection between polls). Used only for feed-time stale classification.
		const serverNow = untrack(() => sharedClock.serverNow);
		const filter = filters.state;
		const stale = live.vehiclesIsStale;
		const ctx: MapLayerFeedContext = {
			routes: {
				items: routeLineRoutes,
				selected: selectedRouteLine,
			},
			vehicles: {
				motion: vehicleMotion,
				items: live.vehicles?.vehicles ?? [],
				filter,
				alertIds: alertVehicleIds,
				selectedId: selectedVehicleId,
				serverNow,
				ttlS: liveTtl,
				tickKey: live.vehiclesGeneratedUtc,
				stale,
				// FORWARD projection: speed + fix-time per bus, the route shape to walk,
				// and the live skew-free clock read each frame. Reduced motion, global
				// stale, and raw mode snap to reported positions instead.
				fixFor,
				shapeFor: animate ? shapeFor : undefined,
				serverNowFn: () => untrack(() => sharedClock.serverNowContinuousMs()),
				animate,
			},
			stops: {
				items: stops.data?.stops ?? [],
				filter,
				alertIds: alertEntitySets.stops,
				selectedId: selectedStopId,
			},
			nearTarget: {
				target: nearMeController.origin,
			},
		};

		for (const module of MAP_LAYER_MODULES) module.feed(m, ctx);
	});

	$effect(() => {
		const m = map;
		const entries = stopList;
		void selected;
		void hovered;
		if (!m) return;
		untrack(() => emphasisController.apply(m, entries));
	});

	let replayMap: MapLibreMap | null = null;
	let replayRevision = -1;
	$effect(() => {
		const m = map;
		const revision = layerRevision;
		if (!m) return;
		const shouldReplay = replayMap === m && replayRevision !== revision;
		replayMap = m;
		replayRevision = revision;
		if (shouldReplay) untrack(() => emphasisController.replay(m));
	});

	$effect(() => {
		if (!detailOpen) return;
		if (selected && !selectedDetail) {
			if (selected.kind === 'vehicle' && vehicleGraceState.presence !== 'gone') return;
			if (waitingForSelectedDetail()) return;
			closeDetail();
		}
	});

	// Seed the live CSS vars from the panel state once mounted so the dragged width is
	// restored on a reload. SSR paints the 360px CSS default (no JS), so there is no
	// flash: we only overwrite client-side. The map canvas never reads either var, so
	// writing them can NEVER resize the map.
	//   · --app-right-detail-offset = the overlay's own width (the panel box).
	//   · --map-detail-offset = how far the FLOATING CHROME (near-me, peek, freshness,
	//     attribution) must shift left to clear the open panel: the live width while
	//     open + expanded, the 3.7rem strip while collapsed, 0 while closed (the chrome
	//     sits flush to the map's own right edge again).
	$effect(() => {
		const el = heroEl;
		if (!el) return;
		const open = detailOpen && layout.isDesktop;
		return publishRailOffset(el, detailWidthPx, open, detailCollapsed, detailDragging);
	});

	// Collapse/expand the right detail panel. A pure local toggle: it flips
	// `data-detail-collapsed` on .map-hero, which the CSS reads to slide the overlay
	// OFF the right edge (collapses to the RIGHT, never to the left / mid-air). The
	// selection stays alive so expanding restores the same detail. The drag/keyboard
	// resize handlers live in MapDetailOverlay (the only logic-bearing child) — they
	// touch nothing but the width var + localStorage, never the map.
	function toggleDetailCollapsed(): void {
		detailCollapsed = !detailCollapsed;
	}
</script>

<!-- The map canvas. The hero renders exactly ONE MapStage
     (one GL context, one onready). Because the detail/filter/rail panels all OVERLAY
     the map (absolute) rather than sit in its flow, opening/closing/dragging any of
     them never remounts the GL context and never changes the map's size — the canvas
     is full-bleed and fixed, resized only by MapStage's own container ResizeObserver
     on a genuine viewport change. -->
{#snippet mapBody()}
	<!-- HOT FIRST PAINT (B2): MapStage awaits the basemap via `basemapLoader` INSIDE
	     its own onMount and bakes the resolved basemap into the constructor style, so
	     the very first frame already carries the hosted basemap — no post-mount
	     `setStyle` wipe, no flicker, no blank-then-repaint. The `basemap` prop stays
	     `undefined` (deferred) so the live resource settling from null does NOT fire a
	     downgrade swap; a real pointer change (snapshot republish via dataRefresh)
	     re-runs getBasemap through the same loader on remount. Theme swaps still
	     repaint via the `theme` prop's lighter applyBasemapTheme path. -->
	<MapStage
		class="map-hero-stage"
		basemapLoader={({ signal }) => getBasemap({ signal })}
		{theme}
		center={mapInitialCenter}
		bounds={ISLAND_FIT_BOUNDS}
		maxBounds={MAP_MAX_BOUNDS}
		fitPadding={mapFitPadding}
		onready={onMapReady}
		onstyleload={onMapStyleLoad}
		onthemerepaint={onMapThemeRepaint}
		onerror={(failure) => (mapFailure = failure)}
		onbeforeremove={releaseMapOwners}
		locale={{
			'Map.Title': t.mapCanvasLabel,
			'AttributionControl.ToggleAttribution': t.attributionToggle,
		}}
		label={t.mapLabel}
	/>
	<!-- The live framing vignette stays in MapSurfaceCanvasLayer. -->
{/snippet}

{#snippet detailPanel()}
	<!-- prettier-ignore --><RightPanel {locale} identity={detailIdentity} footer={detailFooter} surfaceKey={detailSurfaceKey} canGoBack={selectionStack.length > 0} onback={goBackDetail} onclose={closeDetail} collapsed={detailCollapsed} ontogglecollapse={toggleDetailCollapsed} resizable>
		{#if selectedDetail}
			<MapSelectionDetail
				detail={selectedDetail}
				{locale}
				notReporting={selectedVehicleAbsence}
				{selectionPresence}
				{selectionSourceHealth}
				onrefresh={live.refresh}
				onselect={selectFromDetail}
				onfilter={applyDetailFilter}
				onalertselect={selectAlertRelated}
			/>
		{/if}
	</RightPanel>
{/snippet}

{#snippet detailIdentity()}<!-- prettier-ignore --><MapSelectionDetail detail={selectedDetail} {locale} presentation="identity" />{/snippet}
{#snippet detailFooter()}<!-- prettier-ignore --><MapSelectionDetail detail={selectedDetail} {locale} presentation="action" onfilter={applyDetailFilter} />{/snippet}

<!-- The unified Controls panel — ONE source of truth shared by the desktop
     overlay AND the mobile drawer (MapFilterPill). It is MapFilters in
     controlsMode (titled "Controls") with the inline motion toggle pinned to its
     top via the `motionHeader` snippet. Rendering the SAME snippet on both
     breakpoints keeps the desktop panel and the mobile drawer identical — no
     divergent call sites. -->
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

<!-- The map SURFACE — the full-bleed canvas plus every floating overlay (title,
     near-me, Controls panel, freshness, feed-stall, live-edge, hover peek). It fills
     the whole hero (inset:0). The right-edge chrome (near-me, peek, freshness) reads
     --map-detail-offset so it shifts clear of the open detail overlay. Rendered ONCE,
     so the GL context is stable. -->
{#snippet mapSurface()}
	<div class="map-surface">
		<!-- The full-bleed GL canvas base layer + framing vignette. The orchestrator's
		     mapBody snippet (the single <MapStage .../> mount) is handed down so the GL
		     context + camera wiring stay owned here, never fragmented into the child. -->
		<MapSurfaceCanvasLayer {mapBody} />

		<!-- The desktop floating chrome layer — title, near-me, Controls panel,
		     freshness, feed-stall, live-edge, and the desktop hover peek. ZERO state
		     mutation: every value + handler + the shared `controls` snippet is passed
		     down from this orchestrator. -->
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
	data-motion-tick-key={live.vehiclesGeneratedUtc ?? undefined}
	bind:this={heroEl}
	bind:clientWidth={mapWidthPx}
>
	<!-- The map canvas is FULL-BLEED and FIXED: mapSurface (the .map-surface inset:0)
	     fills the whole hero, and EVERY panel OVERLAYS it (absolute). The map sizes off
	     its own container (MapStage's ResizeObserver) and never reads a panel width, so
	     dragging or collapsing any panel can never resize the map. There is no paneforge
	     pane redistributing width here — the violation the operator hit. -->
	{@render mapSurface()}

	<!-- RIGHT DETAIL panel — an absolute OVERLAY anchored flush to the map's right edge
	     (NOT a pane). It is DRAGGABLE on its left edge (writes the clamped --app-right-
	     detail-offset CSS var) and COLLAPSIBLE (data-detail-collapsed slides it OFF the
	     right edge, never to the left). Only the overlay itself takes pointer events, so
	     the map stays interactive underneath. Desktop only; mobile uses the BottomSheet
	     below. Rendered on `detailOpen` (not on resolved data) so the surface stays
	     mounted while a back target resolves. The orchestrator owns the open/desktop gate
	     + the CSS-var seeding; MapDetailOverlay is the BODY (with the drag/keyboard logic). -->
	{#if layout.isDesktop && detailOpen}
		<MapDetailOverlay
			bind:widthPx={detailWidthPx}
			bind:collapsed={detailCollapsed}
			bind:dragging={detailDragging}
			resizeAria={detailResizeAria}
			{detailPanel}
		/>
	{/if}

	<!-- Mobile: the detail rides a bottom sheet (the desktop detail lives in the
	     right overlay above). A SIBLING of the desktop overlay; the orchestrator owns
	     the open/mobile gate. -->
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
		/* The width of the RIGHT DETAIL overlay, written live by the drag handle into
		   --app-right-detail-offset. The floating map chrome (near-me, peek, freshness,
		   attribution) reads --map-detail-offset to shift clear of the open panel; it
		   resolves to 0 when closed and 3.7rem when collapsed, so chrome clears the
		   reachable strip. The MAP CANVAS never reads either var, so resizing the panel
		   can not resize it. */
		--app-right-detail-offset: var(--size-detail-panel);
		--map-detail-offset: 0rem;
		/* One mobile bottom-chrome baseline. It keeps both touch controls above the
		   fully expanded MapLibre attribution instead of letting three independent
		   bottom offsets overlap. */
		--map-mobile-control-bottom: calc(5.25rem + env(safe-area-inset-bottom, 0px));
		/* Map-internal stacking ladder (P5.3d §C4 P5). These custom properties are
		   the source of truth. Deliberately NOT global --z-* tokens — they order
		   overlays WITHIN the canvas only and are all capped under --z-nav. */
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

	/* The map surface is FULL-BLEED: it fills the whole hero (inset:0) and is the BASE
	   layer beneath every floating overlay (vignette z-5, overlays z-10+). It is the
	   ONLY size driver for the GL canvas (via MapStage's own ResizeObserver), so no
	   panel ever sits in its flow — collapsing/dragging a panel leaves it untouched. */
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
