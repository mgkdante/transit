<!--
  MapHero — the citizen-first live vehicle map (Family A, slice-9.3 hero).

  ENCODING DOCTRINE (one colour per entity, state→filter): buses render in ONE
  calm brand orange with directional kites; no-heading buses are squares; stops
  are yellow diamonds, zoom-gated so the 8,986-stop catalogue never
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
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/stores';
	import { goto, afterNavigate } from '$app/navigation';
	import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
	import { getLocale, type Locale } from '$lib/i18n';
	import { themeStore } from '$lib/stores';
	import { layout } from '$lib/nav';
	import {
		createLiveStore,
		getV1Context,
		getBasemap,
		getRoute,
		getRoutesIndex,
		getStop,
		getStopsIndex,
		type RouteFile,
		type StopFile,
	} from '$lib/v1';
	import type { Alert } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import { createFilterStore, fromSearchParams, type Chip } from '$lib/filters';
	import {
		clearNearTargetSearchParams,
		copyNearTargetSearchParams,
		setNearTargetSearchParams,
	} from '$lib/search/mapNear';
	import { nearTargetFromSearchParams } from '$lib/search/mapNear';
	import { BottomSheet, RightPanel } from '$lib/components/shell';
	import { ResizablePaneGroup, ResizablePane, ResizableHandle } from '$lib/components/ui/resizable';
	import {
		MapStage,
		bakeVehicleSprites,
		bakeLocationPinSprite,
		addVehicleSource,
		addVehicleLayers,
		setStale,
		toVehicleFeatures,
		createVehicleMotionController,
		addStopsSource,
		addStopsLayer,
		setStops,
		addRouteLineSource,
		addRouteLineLayers,
		setRouteLines,
		addNearTargetSource,
		addNearTargetLayer,
		setNearTarget,
		nearestStops,
		centerFromProviderBbox,
		type LatLon,
		type MapFitPadding,
		type WithDistance,
		type VehicleMotionController,
	} from '$lib/components/map';
	import MapFilters from './MapFilters.svelte';
	import MapFilterPill from './MapFilterPill.svelte';
	import MapLiveFreshness from './MapLiveFreshness.svelte';
	import MapNearMeControl from './MapNearMeControl.svelte';
	import MapSelectionDetail from './MapSelectionDetail.svelte';
	import { copy as MAP_COPY } from './map.copy';
	import { shouldAnimate } from '$lib/motion/policy';
	import { buildAlertEntitySets, vehicleHasAlert } from './mapAlerts';
	import { PICKABLE_MAP_LAYERS, pickMapSelection } from './mapPicking';
	import { resolveMapSelection, type MapSelection } from './mapSelection';
	import type { GeocodedLocation, GeocodePrecision, GeocodeSuggestion } from '$lib/geocode/types';
	import { hasCoordinates } from '$lib/geocode/types';
	import type { StopIndexEntry } from '$lib/v1/schemas';

	const locale: Locale = getLocale();
	const t = $derived(MAP_COPY[locale]);
	const theme = $derived(themeStore.current);
	const v1 = getV1Context();
	const manifest = v1.manifest;
	// Initial framing fits the ISLAND itself (OSM Île de Montréal extremes), NOT
	// the wide basemap square — so the off-island south-shore EAST (Longueuil →
	// Otterburn → past Saint-Basile-le-Grand) is cropped instead of eating the
	// right half. On desktop a left reserve shifts the island RIGHT, clear of the
	// filter panel, and reveals west map (Lac Saint-Louis) in the freed-up left.
	// maxBounds stays the looser basemap square so that west overflow renders
	// without MapLibre clamping. [minLon, minLat, maxLon, maxLat].
	const ISLAND_FIT_BOUNDS = [-73.9764, 45.4022, -73.4761, 45.7029] as const;
	const mapInitialCenter = $derived(centerFromProviderBbox(ISLAND_FIT_BOUNDS));
	const MAP_FIT_PADDING_PX = 40;

	// Map container width — window-reactive ONLY (not panel state), so the framing
	// adapts to the screen but NEVER re-fits when a panel opens/collapses/closes.
	let mapWidthPx = $state(0);

	// Desktop frames the island into a roughly SQUARE central gap with generous
	// left/right BUFFERS sized as a fraction of the width. The buffers (a) crop the
	// off-island east (south-shore sprawl), (b) keep the whole island visible past
	// the left filter panel and the right detail panel at their furthest, and
	// (c) — being static — never shift the map when a panel toggles. The island
	// sits centred in the visible gap: human-centred, not math-centred on the full
	// canvas. Tunable knobs:
	const DESKTOP_LEFT_PAD_FRAC = 0.34; // clears rail + filter panel
	const DESKTOP_RIGHT_PAD_FRAC = 0.18; // detail-panel buffer
	const DESKTOP_VERT_PAD_PX = 56; // small top/bottom → island fills the height (bigger)
	const mapFitPadding = $derived<MapFitPadding>(
		layout.isDesktop && mapWidthPx > 0
			? {
					top: DESKTOP_VERT_PAD_PX,
					bottom: DESKTOP_VERT_PAD_PX,
					left: Math.round(mapWidthPx * DESKTOP_LEFT_PAD_FRAC),
					right: Math.round(mapWidthPx * DESKTOP_RIGHT_PAD_FRAC),
				}
			: MAP_FIT_PADDING_PX,
	);
	type NearMeOrigin = LatLon & { label: string; precision?: GeocodePrecision };

	// URL-DRIVEN filter state — the reusable spine. Seeded from the URL so a reload
	// (or a deep-link like /map?status=late) restores the exact view; every toggle
	// pushes the canonical query via goto (replaceState so the map view isn't
	// disrupted + back/forward stay clean). One map, deep-linkable from anywhere.
	const filters = createFilterStore(fromSearchParams($page.url.searchParams), (search) => {
		const nextSearchParams = new URLSearchParams(search);
		copyNearTargetSearchParams($page.url.searchParams, nextSearchParams);
		const nextSearch = nextSearchParams.toString();
		void goto(nextSearch ? `?${nextSearch}` : $page.url.pathname, {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	});

	// Any client navigation can change the URL filter spine: browser back/forward,
	// top-chrome search, cross-family drilldowns, or the filter pane itself.
	// Replacing from the URL is side-effect-free, so own replaceState pushes are
	// harmless and external search picks apply without a reload.
	afterNavigate(() => {
		filters.replace(fromSearchParams($page.url.searchParams));
		syncNearTargetFromUrl($page.url.searchParams);
	});

	$effect(() => {
		syncNearTargetFromUrl($page.url.searchParams);
	});

	// Basemap pointer (hosted Montréal PMTiles), or null → minimal-dark fallback.
	const basemap = createResource(() => getBasemap());
	// Static stop catalogue (8,986 stops) for the stops layer + (later) near-me.
	const stops = createResource(() => getStopsIndex());
	const routesIndex = createResource(() => getRoutesIndex());
	const selectedRouteIds = $derived(Array.from(filters.routes).sort());
	const selectedRoutes = createResource<RouteFile[]>(async () => {
		const ids = selectedRouteIds;
		if (ids.length === 0) return [];
		const routes = await Promise.all(ids.map((id) => getRoute(id)));
		return routes.filter((route): route is RouteFile => route != null);
	});

	// Live tier — one store for this surface (v1 context booted before mount).
	const live = createLiveStore(manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	let map = $state<MapLibreMap | null>(null);
	let vehicleMotion = $state<VehicleMotionController | null>(null);
	let vehicleMotionMap: MapLibreMap | null = null;
	let layerRevision = $state(0);
	let interactionsMap: MapLibreMap | null = null;
	let selected = $state<MapSelection | null>(null);
	let selectionStack = $state<MapSelection[]>([]);
	let hovered = $state<MapSelection | null>(null);
	let detailOpen = $state(false);
	let nearMeOpen = $state(false);
	let nearMeQuery = $state('');
	let nearMeLoading = $state(false);
	let nearMeError = $state<string | null>(null);
	let nearMeOrigin = $state<NearMeOrigin | null>(null);
	let nearUrlKey = $state('');
	let rightPanelCollapsed = $state(false);
	let rightPanelPane = $state<{ collapse: () => void; expand: () => void } | undefined>();
	let rightPanelEl = $state<HTMLElement | undefined>();
	let rightPanelWidthPx = $state(360);

	const stopList = $derived(stops.data?.stops ?? []);
	const nearbyStops = $derived<WithDistance<StopIndexEntry>[]>(
		nearMeOrigin ? nearestStops(nearMeOrigin, stopList, 5, 1_200) : [],
	);
	const focusedSelection = $derived(selected ?? hovered);
	const focusedRouteId = $derived.by<string | null>(() => {
		if (!focusedSelection) return null;
		if (focusedSelection.kind === 'route') return focusedSelection.id;
		if (focusedSelection.kind === 'vehicle') {
			return live.index.byVehicleId.get(focusedSelection.id)?.route ?? null;
		}
		return null;
	});
	const focusedStopId = $derived.by<string | null>(() => {
		if (!focusedSelection) return null;
		if (focusedSelection.kind === 'stop') return focusedSelection.id;
		if (focusedSelection.kind === 'vehicle') {
			return live.index.byVehicleId.get(focusedSelection.id)?.next_stop ?? null;
		}
		return null;
	});
	const focusedRoute = createResource<RouteFile | null>(async () => {
		const id = focusedRouteId;
		return id ? getRoute(id) : null;
	});
	const focusedStop = createResource<StopFile | null>(async () => {
		const id = focusedStopId;
		return id ? getStop(id) : null;
	});
	const routeList = $derived(
		selectedRouteIds.length === 0
			? []
			: (selectedRoutes.data ?? []).filter((route) => selectedRouteIds.includes(route.id)),
	);
	const routeLineRoutes = $derived(routeList);
	const contextRoutes = $derived.by<RouteFile[]>(() => {
		const out = [...routeList];
		const focus = focusedRoute.data;
		if (focus && !out.some((route) => route.id === focus.id)) out.push(focus);
		return out;
	});
	const contextStopFiles = $derived(focusedStop.data ? [focusedStop.data] : []);
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
	const hoveredVehicleId = $derived(hovered?.kind === 'vehicle' ? hovered.id : null);
	const selectedStopId = $derived(selected?.kind === 'stop' ? selected.id : null);
	const hoveredStopId = $derived(hovered?.kind === 'stop' ? hovered.id : null);
	const selectedRouteLine = $derived(
		selected?.kind === 'route'
			? {
					id: selected.id,
					direction: selected.direction ?? null,
					variantKey: selected.variantKey ?? null,
				}
			: null,
	);
	const selectedDetail = $derived(
		resolveMapSelection(selected, {
			index: live.index,
			stops: stopList,
			routes: contextRoutes,
			stopFiles: contextStopFiles,
			alerts: alertList,
		}),
	);
	const hoverDetail = $derived(
		resolveMapSelection(hovered, {
			index: live.index,
			stops: stopList,
			routes: contextRoutes,
			stopFiles: contextStopFiles,
			alerts: alertList,
		}),
	);
	const detailSurfaceKey = $derived(
		selectedDetail ? `${selectedDetail.kind}:${selectedDetail.id}` : 'empty',
	);
	const mapDetailOffset = $derived(
		detailOpen && layout.isDesktop ? `${Math.round(rightPanelWidthPx)}px` : '0rem',
	);

	function clearHover(m: MapLibreMap): void {
		hovered = null;
		m.getCanvas().style.cursor = '';
	}

	function pickSelectionAt(m: MapLibreMap, e: MapMouseEvent): MapSelection | null {
		const layers = PICKABLE_MAP_LAYERS.filter((layer) => m.getLayer(layer));
		if (layers.length === 0) return null;
		return pickMapSelection(m.queryRenderedFeatures(e.point, { layers }));
	}

	function selectPickedFeature(m: MapLibreMap, e: MapMouseEvent): void {
		const next = pickSelectionAt(m, e);
		if (!next) return;
		addSelectionFilter(next);
		selectionStack = [];
		selected = next;
		detailOpen = true;
	}

	function addSelectionFilter(selection: MapSelection): void {
		switch (selection.kind) {
			case 'vehicle':
				filters.addVehicle(selection.id);
				break;
			case 'stop':
				filters.addStop(selection.id);
				break;
			case 'route':
				filters.addRoute(selection.id);
				break;
		}
	}

	function hoverPickedFeature(m: MapLibreMap, e: MapMouseEvent): void {
		const next = pickSelectionAt(m, e);
		if (sameNullableSelection(hovered, next)) return;
		hovered = next;
		m.getCanvas().style.cursor = next ? 'pointer' : '';
	}

	function closeDetail(): void {
		detailOpen = false;
		selected = null;
		selectionStack = [];
		rightPanelCollapsed = false;
	}

	function toggleRightPanelCollapsed(): void {
		if (rightPanelCollapsed) {
			rightPanelPane?.expand();
			rightPanelCollapsed = false;
		} else {
			rightPanelPane?.collapse();
			rightPanelCollapsed = true;
		}
	}

	function selectFromDetail(next: MapSelection): void {
		if (selected && !sameSelection(selected, next)) {
			selectionStack = [...selectionStack, selected];
		}
		selected = next;
		detailOpen = true;
	}

	function goBackDetail(): void {
		const previous = selectionStack.at(-1);
		if (!previous) return;
		selectionStack = selectionStack.slice(0, -1);
		selected = previous;
		detailOpen = true;
	}

	function sameSelection(a: MapSelection, b: MapSelection): boolean {
		return (
			a.kind === b.kind &&
			a.id === b.id &&
			selectionDirection(a) === selectionDirection(b) &&
			selectionVariantKey(a) === selectionVariantKey(b)
		);
	}

	function sameNullableSelection(a: MapSelection | null, b: MapSelection | null): boolean {
		if (!a && !b) return true;
		if (!a || !b) return false;
		return sameSelection(a, b);
	}

	function selectionDirection(selection: MapSelection): number | null {
		return selection.kind === 'route' ? (selection.direction ?? null) : null;
	}

	function selectionVariantKey(selection: MapSelection): string | null {
		return selection.kind === 'route' ? (selection.variantKey ?? null) : null;
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
		filters.setAlerts(['has_alert']);
		for (const route of alert.routes ?? []) {
			filters.addRoute(route);
		}
		for (const stop of alert.stops ?? []) {
			filters.addStop(stop);
		}
		const firstStop = alert.stops?.[0];
		const firstRoute = alert.routes?.[0];
		if (firstStop) {
			selectFromDetail({ kind: 'stop', id: firstStop });
		} else if (firstRoute) {
			selectFromDetail({ kind: 'route', id: firstRoute });
		}
	}

	function setNearMeOrigin(origin: NearMeOrigin, syncUrl = true): void {
		nearMeOrigin = origin;
		nearMeError = null;
		if (syncUrl) syncNearTargetToUrl(origin);
		flyToNearMeOrigin(origin);
	}

	function syncNearTargetToUrl(origin: NearMeOrigin): void {
		const nextSearchParams = new URLSearchParams($page.url.searchParams);
		setNearTargetSearchParams(nextSearchParams, origin);
		const nextSearch = nextSearchParams.toString();
		nearUrlKey = nearTargetKey(origin);
		void goto(nextSearch ? `?${nextSearch}` : $page.url.pathname, {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	}

	function syncNearTargetFromUrl(searchParams: URLSearchParams): void {
		const nearTarget = nearTargetFromSearchParams(searchParams);
		if (!nearTarget) {
			nearUrlKey = '';
			nearMeOrigin = null;
			return;
		}

		const key = nearTargetKey(nearTarget);
		if (nearUrlKey === key) return;

		nearUrlKey = key;
		nearMeOpen = true;
		nearMeQuery = '';
		setNearMeOrigin(nearTarget, false);
	}

	function clearNearMeOrigin(): void {
		nearMeOrigin = null;
		nearMeQuery = '';
		nearMeError = null;
		nearUrlKey = '';

		const nextSearchParams = new URLSearchParams($page.url.searchParams);
		clearNearTargetSearchParams(nextSearchParams);
		const nextSearch = nextSearchParams.toString();
		void goto(nextSearch ? `?${nextSearch}` : $page.url.pathname, {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	}

	/** Camera move that honours prefers-reduced-motion: jumpTo (no flight) under
	 * reduce, flyTo otherwise. `essential` alone does NOT respect reduced motion. */
	function panTo(center: [number, number], zoom: number): void {
		if (!map) return;
		if (shouldAnimate('motion-gated')) map.flyTo({ center, zoom, essential: true });
		else map.jumpTo({ center, zoom });
	}

	function flyToNearMeOrigin(origin: NearMeOrigin): void {
		if (!map) return;
		panTo(
			[origin.lon, origin.lat],
			Math.max(map.getZoom(), zoomForNearMePrecision(origin.precision)),
		);
	}

	function zoomForNearMePrecision(precision?: GeocodePrecision): number {
		switch (precision) {
			case 'address':
				return 17;
			case 'street':
				return 15;
			case 'postal':
				return 14;
			case 'neighbourhood':
				return 13;
			default:
				return 14;
		}
	}

	function nearTargetKey(origin: NearMeOrigin): string {
		return `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}:${origin.label}`;
	}

	function useNearMeLocation(): void {
		nearMeOpen = true;
		if (!navigator.geolocation) {
			nearMeError = t.nearMeError;
			return;
		}
		nearMeLoading = true;
		nearMeError = null;
		navigator.geolocation.getCurrentPosition(
			(position) => {
				nearMeLoading = false;
				setNearMeOrigin({
					lat: position.coords.latitude,
					lon: position.coords.longitude,
					label: t.nearMeUseLocation,
					precision: 'address',
				});
			},
			() => {
				nearMeLoading = false;
				nearMeError = t.nearMeError;
			},
			{ enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
		);
	}

	async function searchNearMe(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const query = nearMeQuery.trim();
		if (!query) return;

		const manual = parseCoordinateQuery(query);
		if (manual) {
			setNearMeOrigin({ ...manual, label: query, precision: 'address' });
			return;
		}

		await resolveNearMeQuery(query);
	}

	async function resolveNearMeQuery(query: string): Promise<void> {
		nearMeLoading = true;
		nearMeError = null;
		try {
			const response = await fetch(`/api/geocode/montreal?q=${encodeURIComponent(query)}`);
			if (!response.ok) {
				nearMeError = t.nearMeError;
				return;
			}
			const result = (await response.json()) as GeocodedLocation;
			nearMeQuery = result.label;
			setNearMeOrigin(result);
		} catch {
			nearMeError = t.nearMeError;
		} finally {
			nearMeLoading = false;
		}
	}

	async function selectNearMeSuggestion(result: GeocodeSuggestion): Promise<void> {
		nearMeQuery = result.label;
		if (hasCoordinates(result)) {
			setNearMeOrigin(result);
			return;
		}
		await resolveNearMeQuery(result.label);
	}

	function selectNearbyStop(stop: WithDistance<StopIndexEntry>): void {
		filters.addStop(stop.id);
		selectionStack = [];
		selected = { kind: 'stop', id: stop.id };
		detailOpen = true;
		if (map) panTo([stop.lon, stop.lat], Math.max(map.getZoom(), 15));
	}

	function parseCoordinateQuery(query: string): LatLon | null {
		const match = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
		if (!match) return null;
		const lat = Number(match[1]);
		const lon = Number(match[2]);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
		if (lat < 45.35 || lat > 45.75 || lon < -74.05 || lon > -73.35) return null;
		return { lat, lon };
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

	function installMapInteractions(m: MapLibreMap): void {
		if (interactionsMap === m) return;
		interactionsMap = m;

		m.on('click', (e) => selectPickedFeature(m, e));
		m.on('mousemove', (e) => hoverPickedFeature(m, e));
		m.getCanvas().addEventListener('mouseleave', () => clearHover(m));
	}

	function installMapLayers(m: MapLibreMap): void {
		bakeVehicleSprites(m);
		bakeLocationPinSprite(m);
		// Routes UNDER stops/buses; buses ride on top.
		addRouteLineSource(m);
		addRouteLineLayers(m);
		addStopsSource(m);
		addStopsLayer(m);
		addVehicleSource(m);
		addVehicleLayers(m);
		if (vehicleMotionMap !== m) {
			vehicleMotion?.destroy();
			vehicleMotion = createVehicleMotionController(m);
			vehicleMotionMap = m;
		}
		addNearTargetSource(m);
		addNearTargetLayer(m);
		installMapInteractions(m);
		layerRevision += 1;
	}

	function onMapReady(m: MapLibreMap): void {
		map = m;
		installMapLayers(m);
		if (nearMeOrigin) flyToNearMeOrigin(nearMeOrigin);
	}

	function onMapStyleLoad(m: MapLibreMap): void {
		installMapLayers(m);
	}

	// Feed the layers: vehicles coloured/dimmed under the active filter + the stop
	// catalogue; dim on stale. Reactive to filters.state so a chip toggle re-paints.
	$effect(() => {
		const m = map;
		// Reading `layerRevision` registers the post-style-swap layer install as an
		// effect dependency, so data is re-fed after MapLibre clears custom sources.
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		layerRevision;
		if (!m) return;
		setRouteLines(m, routeLineRoutes, selectedRouteLine);
		vehicleMotion?.set(
			toVehicleFeatures(
				live.vehicles?.vehicles ?? [],
				filters.state,
				alertVehicleIds,
				selectedVehicleId,
				hoveredVehicleId,
			),
			{
				tickKey: live.vehicles?.generated_utc ?? live.generatedUtc,
				stale: live.isStale,
			},
		);
		setStops(
			m,
			stops.data?.stops ?? [],
			filters.state,
			alertEntitySets.stops,
			selectedStopId,
			hoveredStopId,
		);
		setNearTarget(m, nearMeOrigin);
		setStale(m, live.isStale);
	});

	$effect(() => {
		if (!detailOpen) {
			selected = null;
			selectionStack = [];
			rightPanelCollapsed = false;
			return;
		}
		if (selected && !selectedDetail) {
			if (waitingForSelectedDetail()) return;
			closeDetail();
		}
	});

	$effect(() => {
		const node = rightPanelEl;
		if (!node || typeof ResizeObserver === 'undefined') return;

		const observer = new ResizeObserver(([entry]) => {
			rightPanelWidthPx = entry.contentRect.width;
		});
		observer.observe(node);

		return () => observer.disconnect();
	});
</script>

<div
	class="map-hero"
	bind:clientWidth={mapWidthPx}
	style={`--map-detail-offset: ${mapDetailOffset}`}
>
	<!-- Mount immediately with the built-in fallback style; the optional PMTiles
	     basemap can resolve later and repaint without leaving the map blank. -->
	<MapStage
		class="map-hero-stage"
		basemap={basemap.data}
		{theme}
		center={mapInitialCenter}
		bounds={ISLAND_FIT_BOUNDS}
		maxBounds={manifest.bbox}
		fitPadding={mapFitPadding}
		onready={onMapReady}
		onstyleload={onMapStyleLoad}
		label={t.mapLabel}
	/>

	<!-- Top-left: map title. -->
	<div class="map-overlay map-head">
		<div class="map-kicker-row">
			<p class="map-kicker">{t.kicker}</p>
			<MapLiveFreshness
				placement="head"
				generatedUtc={live.generatedUtc}
				ageSeconds={live.ageSeconds}
				isStale={live.isStale}
				{locale}
			/>
		</div>
		<div class="map-title-row">
			<h1 class="map-heading">{t.heading}<span class="map-dot">.</span></h1>
		</div>
	</div>

	<MapNearMeControl
		bind:open={nearMeOpen}
		bind:query={nearMeQuery}
		{locale}
		copy={t}
		loading={nearMeLoading}
		error={nearMeError}
		origin={nearMeOrigin}
		stops={nearbyStops}
		onuselocation={useNearMeLocation}
		onsearch={searchNearMe}
		onsuggestion={selectNearMeSuggestion}
		onstopselect={selectNearbyStop}
		onclear={clearNearMeOrigin}
	/>

	<!-- Left: the combinable state filter (URL-driven). -->
	<div class="map-overlay map-filter-panel">
		<MapFilters
			store={filters}
			{locale}
			routes={routesIndex.data?.routes ?? []}
			stops={stops.data?.stops ?? []}
		/>
	</div>

	<MapFilterPill
		store={filters}
		{locale}
		routes={routesIndex.data?.routes ?? []}
		stops={stops.data?.stops ?? []}
		hidden={detailOpen}
	/>

	<MapLiveFreshness
		placement="floating"
		generatedUtc={live.generatedUtc}
		ageSeconds={live.ageSeconds}
		isStale={live.isStale}
		{locale}
	/>

	{#if hoverDetail && layout.isDesktop}
		<div class="map-overlay map-peek" aria-live="polite">
			<MapSelectionDetail
				detail={hoverDetail}
				{locale}
				compact
				onselect={selectFromDetail}
				onfilter={applyDetailFilter}
				onalertselect={selectAlertRelated}
			/>
		</div>
	{/if}

	{#if detailOpen}
		{#if layout.isDesktop}
			<div class="map-detail-dock">
				<ResizablePaneGroup direction="horizontal" class="map-detail-resize">
					<ResizablePane defaultSize={49} minSize={0}>
						<div class="map-detail-resize-space" aria-hidden="true"></div>
					</ResizablePane>
					<ResizableHandle withHandle class="map-detail-resize-handle" />
					<ResizablePane
						bind:this={rightPanelPane}
						defaultSize={51}
						minSize={32}
						maxSize={74}
						collapsible
						collapsedSize={9}
						onCollapse={() => (rightPanelCollapsed = true)}
						onExpand={() => (rightPanelCollapsed = false)}
					>
						<div class="map-detail-panel-frame" bind:this={rightPanelEl}>
							<RightPanel
								{locale}
								title={selectedDetail?.title}
								surfaceKey={detailSurfaceKey}
								canGoBack={selectionStack.length > 0}
								onback={goBackDetail}
								onclose={closeDetail}
								resizable
								collapsed={rightPanelCollapsed}
								ontogglecollapse={toggleRightPanelCollapsed}
							>
								{#if selectedDetail}
									<MapSelectionDetail
										detail={selectedDetail}
										{locale}
										onselect={selectFromDetail}
										onfilter={applyDetailFilter}
										onalertselect={selectAlertRelated}
									/>
								{/if}
							</RightPanel>
						</div>
					</ResizablePane>
				</ResizablePaneGroup>
			</div>
		{:else}
			<BottomSheet
				bind:open={detailOpen}
				{locale}
				title={selectedDetail?.title}
				surfaceKey={detailSurfaceKey}
				canGoBack={selectionStack.length > 0}
				onback={goBackDetail}
			>
				{#if selectedDetail}
					<MapSelectionDetail
						detail={selectedDetail}
						{locale}
						onselect={selectFromDetail}
						onfilter={applyDetailFilter}
						onalertselect={selectAlertRelated}
					/>
				{/if}
			</BottomSheet>
		{/if}
	{/if}
</div>

<style>
	.map-hero {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		--map-detail-offset: 0rem;
	}
	.map-hero:has(:global(.right-panel[data-open='true'])) {
		--map-detail-offset: 360px;
	}
	.map-hero:has(:global(.right-panel[data-open='false'])) {
		--map-detail-offset: 3.7rem;
	}
	.map-hero :global(.map-stage) {
		border-radius: 0;
	}

	.map-overlay {
		position: absolute;
		z-index: 10;
	}
	.map-head {
		top: 1rem;
		left: calc(var(--app-left-rail-offset, 0rem) + 1rem);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-width: calc(
			100% - var(--app-left-rail-offset, 0rem) - var(--map-detail-offset, 0rem) - 2rem
		);
	}
	.map-kicker-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.map-kicker {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.map-title-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}
	.map-heading {
		margin: 0;
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-subheading);
		line-height: 1;
		color: var(--foreground);
	}
	.map-dot {
		color: var(--primary);
	}
	.map-filter-panel {
		top: 5.25rem;
		left: calc(var(--app-left-rail-offset, 0rem) + 1rem);
	}

	.map-peek {
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		bottom: 1rem;
		z-index: 24;
		max-width: min(20rem, calc(100% - 2rem));
		padding: 0.75rem;
		background: color-mix(in srgb, var(--card) 94%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(10px);
		pointer-events: none;
	}
	.map-detail-dock {
		position: absolute;
		inset-block: 0;
		right: 0;
		width: min(44rem, calc(100% - 4rem));
		z-index: 25;
		pointer-events: none;
	}
	:global(.map-detail-resize) {
		pointer-events: none;
	}
	.map-detail-resize-space {
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.map-detail-panel-frame {
		height: 100%;
		min-width: 0;
		pointer-events: auto;
	}
	:global(.map-detail-resize-handle) {
		width: 8px;
		pointer-events: auto;
		background: var(--border);
		border-radius: var(--radius-sm);
		transition: background var(--duration-fast, 120ms) var(--ease-default, ease);
	}
	:global(.map-detail-resize-handle:hover),
	:global(.map-detail-resize-handle:focus-visible),
	:global(.map-detail-resize-handle[data-active='pointer']) {
		background: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.mf-chip) {
			transition: none;
		}
		:global(.map-detail-resize-handle) {
			transition: none;
		}
	}

	@media (max-width: 760px) {
		.map-head {
			top: 0.75rem;
			left: 0.75rem;
			right: 0.75rem;
			max-width: calc(100% - 1.5rem);
		}
		.map-filter-panel {
			display: none;
		}
		.map-peek {
			display: none;
		}
	}
</style>
