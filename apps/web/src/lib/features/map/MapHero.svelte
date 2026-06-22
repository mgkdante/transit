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
	import { onMount, untrack } from 'svelte';
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
	import { clearMapFocusSearchParams, parseMapFocus, type MapFocus } from '$lib/search/mapFocus';
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
		type ShapeResolver,
		type Coord,
	} from '$lib/components/map';
	import {
		bestShapeForPoint,
		routeShapes,
		type RouteShapes,
	} from '$lib/components/map/vehicleShapes';
	import {
		liveTtlS,
		silenceAgeS,
		silenceOpacity,
		silenceOpacityDiscrete,
	} from '$lib/components/map/vehicleSilence';
	import { sharedClock } from '$lib/stores';
	import { isPrefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import MapFilters from './MapFilters.svelte';
	import { mapRailSizing } from './mapRailSizing';
	import MapFilterPill from './MapFilterPill.svelte';
	import MapFreshness from './MapFreshness.svelte';
	import MapNearMeControl from './MapNearMeControl.svelte';
	import MapSelectionDetail from './MapSelectionDetail.svelte';
	import { routeBoundsFromFile, zoomForNearMePrecision } from './mapGeo';
	import { parseCoordinateQuery, nearTargetKey } from './mapNearMe';
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
	// Island bounds (verified OSM Île de Montréal extremes: W -73.9757 / E -73.4764
	// / S 45.4022 / N 45.7028) — the camera FIT target.
	const ISLAND_FIT_BOUNDS = [-73.9757, 45.4022, -73.4764, 45.7028] as const;
	const mapInitialCenter = $derived(centerFromProviderBbox(ISLAND_FIT_BOUNDS));
	const MAP_FIT_PADDING_PX = 40;

	// HARD pan/view limit. East edge ~Saint-Basile-le-Grand (-73.30): far enough
	// past the island NE tip (-73.476) to leave room for the right BAND/buffer the
	// detail panel sits over (left maxBounds gives the same ~0.19° room for the
	// perfect left band), but tight enough that the far sprawl (Otterburn →
	// Carignan → Saint-Mathias) is still cropped. Fit padding only *positions* — it
	// can't render a band where maxBounds has no room, which is why a tighter east
	// edge made the right band vanish while the left one worked.
	const MAP_MAX_BOUNDS = [-74.32, 45.3, -73.2, 45.82] as const;

	// Hero width — window-reactive ONLY (not panel state). Kept as the seed/fallback
	// for the fit-padding fraction math before the map stage element measures.
	// Seeded with a desktop default so the fraction padding applies even before the
	// first clientWidth measurement (a 0 here would fall back to the wide fit).
	let mapWidthPx = $state(1280);
	// The LIVE width of the actual map container (the left pane), which physically
	// shrinks when the detail pane opens/resizes. The fit padding (left/right
	// fractions) must be computed off THIS, not the full hero: a refit fired while
	// the panel is open (theme/basemap swap, bounds/maxBounds tweak) would otherwise
	// size its padding to ~80% of the FULL hero — exceeding the shrunk pane width →
	// MapLibre treats it as degenerate padding → off-centre fit. Falls back to the
	// hero width until the pane measures (initial load = panel closed = pane IS hero).
	let mapStagePaneEl = $state<HTMLElement | null>(null);
	let mapStageWidthPx = $state(0);
	const fitWidthPx = $derived(mapStageWidthPx > 0 ? mapStageWidthPx : mapWidthPx);

	// Desktop frames the island into a roughly SQUARE central gap with generous
	// left/right BUFFERS sized as a fraction of the width. The buffers (a) crop the
	// off-island east (south-shore sprawl), (b) keep the whole island visible past
	// the left filter panel and the right detail panel at their furthest, and
	// (c) — being static — never shift the map when a panel toggles. The island
	// sits centred in the visible gap: human-centred, not math-centred on the full
	// canvas. Tunable knobs:
	const DESKTOP_LEFT_PAD_FRAC = 0.37; // clears rail + filter panel, with band
	const DESKTOP_RIGHT_PAD_FRAC = 0.43; // buffer for the right detail panel + band
	const DESKTOP_VERT_PAD_PX = 56; // small top/bottom → island fills the height (bigger)
	const mapFitPadding = $derived<MapFitPadding>(
		layout.isDesktop && fitWidthPx > 0
			? {
					top: DESKTOP_VERT_PAD_PX,
					bottom: DESKTOP_VERT_PAD_PX,
					left: Math.round(fitWidthPx * DESKTOP_LEFT_PAD_FRAC),
					right: Math.round(fitWidthPx * DESKTOP_RIGHT_PAD_FRAC),
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
		readFocusFromUrl($page.url.searchParams);
	});

	$effect(() => {
		syncNearTargetFromUrl($page.url.searchParams);
		readFocusFromUrl($page.url.searchParams);
	});

	// Basemap pointer (hosted Montréal PMTiles), or null → minimal-dark fallback.
	// NOT a createResource here: MapStage resolves it via `basemapLoader` at mount
	// (B2 hot first paint) so it is baked into the constructor style — a resource
	// that settled AFTER mount used to flip basemap.data null→file and trigger a
	// full setStyle wipe (the flicker). getBasemap() is passed straight to the stage.
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

	// Keep the shared clock ticking while the map is mounted: the per-vehicle
	// silence fade re-evaluates off `sharedClock.serverNow`, so a bus can fade
	// BETWEEN polls (the clock cadence honors prefers-reduced-motion).
	$effect(() => sharedClock.subscribe());

	// Tear the motion controller down on component unmount: it owns a running gsap
	// tween (the position lerp), which is otherwise only killed inside
	// installMapLayers when the MAP instance changes — so navigating away from /map
	// would leak a live tween. This effect has no tracked reads, so it runs once and
	// its cleanup fires only on unmount; it reads vehicleMotion lazily there to kill
	// whatever controller is current. The map-instance-change path is unaffected: it
	// destroys the OLD controller before creating a new one, so there is no double
	// destroy (destroy() just kills an already-killed tween, which is a no-op).
	$effect(() => () => untrack(() => vehicleMotion)?.destroy());

	// Live tier ttl (seconds) → derives the silence fade windows so they track the
	// publisher's cadence, not a magic number. Default 30s if the manifest omits it.
	const liveTtl = liveTtlS(manifest.files?.live?.ttl_s);

	let map = $state<MapLibreMap | null>(null);
	let vehicleMotion = $state<VehicleMotionController | null>(null);
	let vehicleMotionMap: MapLibreMap | null = null;

	// --- L1 path-follow shape supply ------------------------------------------
	// Per-route direction-variant polylines, fetched on-demand for the routes that
	// currently have live buses (deduped by route id — far fewer than the ~600
	// vehicles). Loaded through the same getRoute() path as the selected-route
	// linework, then cached so a route is fetched at most once. The tween reads
	// this to walk a bus ALONG its street; until a shape resolves the bus glides
	// the straight chord (progressive enhancement — never blocks, always correct).
	// Intentionally a PLAIN (non-reactive) Map: mutating the cache must NOT trigger
	// rerenders — reactivity is carried explicitly by `routeShapeRevision` so a
	// resolved shape re-feeds exactly once. A SvelteMap would make every .set()
	// reactive and thrash the feed effect.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const routeShapeCache = new Map<string, RouteShapes>();
	// Routes already fetched (or null/empty result cached) so we never re-request.
	// Plain Set for the same reason — a dedupe ledger, not reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const routeShapeRequested = new Set<string>();
	// Bumped when a shape resolves so the feed effect re-runs and the next tween
	// upgrades to path-follow. A plain $state counter (cheap reactive signal).
	let routeShapeRevision = $state(0);
	// Cap distinct cached routes to bound memory over a long session; the visible
	// set is small, so eviction is rare. LRU-ish: oldest insertion dropped first.
	const MAX_CACHED_ROUTE_SHAPES = 200;

	// Previous vehicles-file generated_utc + its parsed epoch ms, so the next
	// re-target can size the tween to the REAL inter-file interval (L2 no-idle).
	let prevVehiclesGeneratedUtc: string | null = null;
	let prevVehiclesGeneratedMs: number | null = null;
	// Signature of the per-vehicle silence-opacity buckets at the last clock-tick
	// re-feed. The tick effect skips re-feeding the vehicle layer when this is
	// unchanged (no bus crossed/moved within the fade window since last tick) so a
	// feed of buses all-fresh or all-floored doesn't rebuild + setData every second
	// for nothing. Reset to '' so the first tick after a (re)install always feeds.
	let lastSilenceSignature = '';
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
	// One-shot "zoom to this picked entity" hint from the URL `focus` param. The
	// resolver effect pans/fits once data is available, then strips the param.
	let pendingFocus = $state<MapFocus | null>(null);
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
	// The id of the route whose line should be highlighted: a directly-selected
	// route, OR the route a selected vehicle is working (so clicking a bus lights
	// up its line). Null when nothing route-bearing is selected — no highlight,
	// honest. Vehicles carry no direction, so the whole route lights up.
	//
	// B3 — for the vehicle case the highlight is GATED on the route still being in
	// the filter spine: selecting a bus promotes its route to filters (the chip),
	// so the line lights up; discarding that route chip removes it from
	// filters.routes, which both drops the `route=` param AND un-highlights the
	// line here — chip and highlight stay in lockstep.
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
	// TODO(beauty2-honest-absence PR-3): upgrade 'no-vehicles' to the inferred
	// reason via $lib/site/serviceWindow.inferAbsenceReason. The map spans the WHOLE
	// network (mixed modes + every route), so there is no single first/last window
	// to claim "closed" against here — a network-wide overnight verdict needs a
	// network service-span signal we do not yet publish. ALSO: a selected-but-silent
	// vehicle should read "last seen N ago" via the 'last-seen' reason key
	// (inferAbsenceReason carries lastSeenIso through) — wire it into the selected-
	// detail panel when the chosen vehicle has gone quiet. Deferred to keep this PR
	// scoped to /route + /stop (the well-defined per-entity windows).
	const liveEdgeState = $derived.by<'unavailable' | 'no-vehicles' | null>(() => {
		if (live.error != null && live.generatedUtc == null) return 'unavailable';
		if (live.vehicles != null && !live.isStale && (live.vehicles.vehicles?.length ?? 0) === 0) {
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
	const hoveredVehicleId = $derived(hovered?.kind === 'vehicle' ? hovered.id : null);
	const selectedStopId = $derived(selected?.kind === 'stop' ? selected.id : null);
	const hoveredStopId = $derived(hovered?.kind === 'stop' ? hovered.id : null);
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

	// Right-rail paneforge percents derived from the LIVE hero width (B1). paneforge
	// sizes in percent, so a constant-rem rail (narrow floor + ceiling + thin
	// collapsed strip) must be re-expressed as a percent of the current hero width —
	// otherwise the same percent renders too wide at every desktop width. mapWidthPx
	// tracks the hero clientWidth (window resize only, NOT pane drag), so these stay
	// stable while dragging yet responsive across 1024/1280/1600. The CSS min/max-
	// width clamp on the pane agrees with these (both derive from the same rems), so
	// the percent floor and the px clamp never fight.
	const railSizing = $derived(mapRailSizing(mapWidthPx));

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
		// Zoom to whatever was clicked, same as a search pick (data is already
		// loaded — it's on the map). Point entities centre + zoom in; a route frames
		// its linework.
		focusSelection(next);
	}

	function addSelectionFilter(selection: MapSelection): void {
		switch (selection.kind) {
			case 'vehicle':
				filters.addVehicle(selection.id);
				// B3 — promote the bus's route to the filter spine so a `route=` param
				// lands in the URL AND a removable route chip renders in MapFilters.
				// Resolve it via the SAME live index the route-line highlight uses
				// (byVehicleId.route), so chip + highlight stay in lockstep. A bus with
				// no route id adds no chip (honest — addRoute('') is a no-op via trim).
				promoteVehicleRoute(selection.id);
				break;
			case 'stop':
				filters.addStop(selection.id);
				break;
			case 'route':
				filters.addRoute(selection.id);
				break;
		}
	}

	/** Resolve a vehicle's route from the live index and add it to the filter store. */
	function promoteVehicleRoute(vehicleId: string): void {
		const route = live.index.byVehicleId.get(vehicleId)?.route;
		if (route) filters.addRoute(route);
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

	// Pick up a one-shot `focus` param; the resolver effect below acts on it.
	function readFocusFromUrl(searchParams: URLSearchParams): void {
		const focus = parseMapFocus(searchParams);
		if (focus) pendingFocus = focus;
	}

	function clearFocusFromUrl(): void {
		const nextSearchParams = new URLSearchParams($page.url.searchParams);
		clearMapFocusSearchParams(nextSearchParams);
		const nextSearch = nextSearchParams.toString();
		void goto(nextSearch ? `?${nextSearch}` : $page.url.pathname, {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	}

	// Zoom to a selection directly (click path) — data is already loaded, so no
	// pending/retry needed. Shared with the URL-driven focus resolver below.
	function focusSelection(selection: MapSelection): void {
		if (selection.kind === 'stop') focusStop(selection.id);
		else if (selection.kind === 'vehicle') focusVehicle(selection.id);
		else focusRoute(selection.id);
	}

	function focusStop(id: string): boolean {
		const stop = stopList.find((s) => s.id === id);
		if (!stop) return false;
		panTo([stop.lon, stop.lat], Math.max(map?.getZoom() ?? 0, 16));
		return true;
	}

	function focusVehicle(id: string): boolean {
		const vehicle = (live.vehicles?.vehicles ?? []).find((v) => v.id === id);
		if (!vehicle) return false;
		panTo([vehicle.lon, vehicle.lat], Math.max(map?.getZoom() ?? 0, 16));
		return true;
	}

	function focusRoute(id: string): boolean {
		const route = routeList.find((r) => r.id === id);
		if (!route) return false;
		const bounds = routeBoundsFromFile(route);
		if (!bounds) return false;
		if (!map) return false;
		map.fitBounds(bounds, {
			padding: 64,
			maxZoom: 15,
			duration: shouldAnimate('motion-gated') ? 600 : 0,
		});
		return true;
	}

	// Resolve the pending focus once the map AND the entity's data are available;
	// reads the kind's reactive source so it re-runs when that data loads, then
	// pans/fits and strips the param so it fires exactly once.
	$effect(() => {
		if (!pendingFocus || !map) return;
		const focus = pendingFocus;
		const resolved =
			focus.kind === 'stop'
				? focusStop(focus.id)
				: focus.kind === 'vehicle'
					? focusVehicle(focus.id)
					: focusRoute(focus.id);
		if (!resolved) return;
		pendingFocus = null;
		clearFocusFromUrl();
	});

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

	function useNearMeLocation(): void {
		nearMeOpen = true;
		// Geolocation silently fails on http; surface the actual reason instead of a
		// generic "place not found".
		if (typeof window !== 'undefined' && !window.isSecureContext) {
			nearMeError = t.nearMeGeoInsecure;
			return;
		}
		if (!navigator.geolocation) {
			nearMeError = t.nearMeGeoUnavailable;
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
			(geoError) => {
				nearMeLoading = false;
				nearMeError =
					geoError.code === geoError.PERMISSION_DENIED
						? t.nearMeGeoDenied
						: geoError.code === geoError.TIMEOUT
							? t.nearMeGeoTimeout
							: t.nearMeGeoUnavailable;
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

	async function selectNearMeSuggestion(
		result: GeocodeSuggestion,
		sessionToken: string,
	): Promise<void> {
		nearMeQuery = result.label;
		if (hasCoordinates(result)) {
			setNearMeOrigin(result);
			return;
		}
		// A Google suggestion carries a placeId but no coordinates — resolve it by
		// id via Place Details (reusing the autocomplete session) so we pin the EXACT
		// place picked, not whatever a fresh text search of the label resolves.
		if (result.placeId && result.source === 'google_places') {
			await resolveNearMePlace(result.placeId, sessionToken);
			return;
		}
		await resolveNearMeQuery(result.label);
	}

	async function resolveNearMePlace(placeId: string, sessionToken: string): Promise<void> {
		nearMeLoading = true;
		nearMeError = null;
		try {
			const response = await fetch(
				`/api/geocode/montreal?placeId=${encodeURIComponent(placeId)}&session=${encodeURIComponent(sessionToken)}`,
			);
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

	function selectNearbyStop(stop: WithDistance<StopIndexEntry>): void {
		filters.addStop(stop.id);
		selectionStack = [];
		selected = { kind: 'stop', id: stop.id };
		detailOpen = true;
		if (map) panTo([stop.lon, stop.lat], Math.max(map.getZoom(), 15));
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
		// Force the next clock-tick re-feed: MapLibre cleared the custom source on a
		// style swap, so the tick effect's short-circuit must not skip the first
		// post-install feed even if the opacity buckets are unchanged.
		lastSilenceSignature = '';
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

	// L1 — lazily fetch route shapes for the routes that currently have live buses
	// (deduped). Runs off the vehicles poll only (other reads untracked) so a
	// filter/hover does not re-trigger fetches. Each route is requested at most
	// once; a resolved shape bumps `routeShapeRevision`, re-running the feed effect
	// so the NEXT tween upgrades that route's buses to path-follow. Fetches are
	// fire-and-forget + fail-soft (a failed/absent shape simply leaves the bus on
	// the chord — never blocks motion). We do NOT bulk-fetch all routes: only the
	// distinct routes in the current vehicle set, which is small.
	$effect(() => {
		const vehicles = live.vehicles?.vehicles ?? [];
		if (vehicles.length === 0) return;
		untrack(() => {
			for (const v of vehicles) {
				const id = v.route;
				if (id == null || id === '') continue;
				if (routeShapeRequested.has(id)) continue;
				routeShapeRequested.add(id);
				void getRoute(id)
					.then((route) => {
						if (!route) return;
						const shapes = routeShapes(route);
						if (shapes.length === 0) return;
						// Bound the cache (drop oldest) so a long session can't grow it
						// unbounded; the visible route set is small so this rarely fires.
						if (routeShapeCache.size >= MAX_CACHED_ROUTE_SHAPES) {
							const oldest = routeShapeCache.keys().next().value;
							if (oldest != null) routeShapeCache.delete(oldest);
						}
						routeShapeCache.set(id, shapes);
						routeShapeRevision += 1;
					})
					.catch(() => {
						// Fail-soft: leave the route un-cached → chord fallback. Allow a
						// later retry by clearing the requested flag.
						routeShapeRequested.delete(id);
					});
			}
		});
	});

	// L1 resolver passed into the motion controller: for a vehicle feature, return
	// the cached route-shape variant its CURRENT point sits on (least projection
	// error), or null → straight-chord fallback. Called once per vehicle at
	// re-target (not per frame), so the per-tween projection cost is paid once.
	const shapeFor: ShapeResolver = (feature) => {
		const routeId = feature.properties.route;
		if (!routeId) return null;
		const shapes = routeShapeCache.get(routeId);
		if (!shapes || shapes.length === 0) return null;
		return bestShapeForPoint(shapes, feature.geometry.coordinates as Coord);
	};

	// L2 — duration of the next position tween = the REAL server-time gap between
	// this vehicles file and the previous one, so the bus is still easing toward
	// its last known fix right up to the next poll (no 2s idle freeze). Falls back
	// to undefined (the controller's default) for the first file or an unparseable
	// stamp; the controller clamps the value into a sane band and NEVER extends
	// motion past the last fix (silence-fade owns a genuinely late bus).
	function nextTweenDurationSec(generatedUtc: string | null | undefined): number | undefined {
		if (generatedUtc == null) return undefined;
		const ms = Date.parse(generatedUtc);
		if (Number.isNaN(ms)) return undefined;
		let duration: number | undefined;
		if (
			prevVehiclesGeneratedUtc != null &&
			prevVehiclesGeneratedUtc !== generatedUtc &&
			prevVehiclesGeneratedMs != null
		) {
			const deltaS = (ms - prevVehiclesGeneratedMs) / 1000;
			if (deltaS > 0) duration = deltaS;
		}
		prevVehiclesGeneratedUtc = generatedUtc;
		prevVehiclesGeneratedMs = ms;
		return duration;
	}

	// Feed the layers: vehicles coloured/dimmed under the active filter + the stop
	// catalogue; dim on stale. Reactive to filters.state so a chip toggle re-paints.
	$effect(() => {
		const m = map;
		// Reading `layerRevision` registers the post-style-swap layer install as an
		// effect dependency, so data is re-fed after MapLibre clears custom sources.
		// Reading `routeShapeRevision` re-runs the feed when a route shape resolves,
		// so the next tween upgrades those buses from chord to path-follow (L1).
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		layerRevision;
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		routeShapeRevision;
		if (!m) return;
		const reduceMotion = isPrefersReducedMotion();
		setRouteLines(m, routeLineRoutes, selectedRouteLine);
		// serverNow read UNTRACKED here so this poll/filter/selection effect is NOT
		// re-run by the per-second clock tick (that is the dedicated silence effect's
		// job below). This pass only needs a current opacity baseline.
		const serverNow = untrack(() => sharedClock.serverNow);
		const tickKey = live.vehicles?.generated_utc ?? live.generatedUtc;
		vehicleMotion?.set(
			toVehicleFeatures(
				live.vehicles?.vehicles ?? [],
				filters.state,
				alertVehicleIds,
				selectedVehicleId,
				hoveredVehicleId,
				{ serverNow, ttlS: liveTtl, reduceMotion },
			),
			{
				tickKey,
				stale: live.isStale,
				// L2: span the real inter-file interval so the bus eases right up to the
				// next poll (no idle freeze). Computed only on a genuinely new file; a
				// same-tickKey filter/hover re-feed does not restart the tween, so the
				// duration is ignored there.
				durationSec: untrack(() => nextTweenDurationSec(tickKey)),
				// L1: per-vehicle route-shape resolver → walk the street; chord when no
				// shape is cached yet. Reduced motion skips animation entirely (the
				// controller snaps), so the resolver is inert there.
				shapeFor: reduceMotion ? undefined : shapeFor,
				// Per-frame continuous fade while the position tween runs — but NOT
				// under reduced motion (then opacity is set discretely at poll/tick
				// time, no per-frame ramp). Reads the live clock each frame so a bus
				// that goes silent mid-interval fades in place.
				refreshOpacity: reduceMotion ? undefined : refreshSilenceOpacity,
			},
		);
		// Sync the tick effect's baseline to what we just fed, so the next clock tick
		// does not redundantly re-feed an identical opacity set right after this poll.
		lastSilenceSignature = untrack(() => silenceSignature(serverNow, reduceMotion));
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

	// Per-frame silence-fade refresher: recompute a bus's opacity from its frozen
	// last-report time and the LIVE skew-free clock. Passed to the motion
	// controller so the running position tween re-stamps opacity every frame — a
	// bus going quiet mid-interval fades in place without waiting for a poll.
	function refreshSilenceOpacity(feature: { properties: { id: string; opacity: number } }): number {
		const updatedUtc = live.index.byVehicleId.get(feature.properties.id)?.updated_utc;
		return updatedUtc == null
			? feature.properties.opacity
			: silenceOpacity(silenceAgeS(updatedUtc, sharedClock.serverNow), liveTtl);
	}

	// Cheap signature of the per-vehicle silence-opacity buckets at a given clock
	// reading. Two ticks with the SAME signature would feed byte-identical opacity,
	// so the tick effect can skip the rebuild + setData. Opacity is quantised to
	// 3 decimals (~0.001 step) so a bus actively fading still changes the signature
	// every tick (it MUST keep updating), while an all-fresh / all-floored feed —
	// where opacity is pinned at 1 or the floor — yields a stable signature and is
	// skipped. Uses the same discrete/continuous branch as the feed so the
	// signature tracks exactly what would be drawn. Cost is one pass over the live
	// vehicles (no FeatureCollection rebuild, no GL call).
	function silenceSignature(serverNow: number, reduceMotion: boolean): string {
		const vehicles = live.vehicles?.vehicles ?? [];
		let sig = `${vehicles.length}`;
		for (const v of vehicles) {
			const ageS = silenceAgeS(v.updated_utc, serverNow);
			const opacity = reduceMotion
				? silenceOpacityDiscrete(ageS, liveTtl)
				: silenceOpacity(ageS, liveTtl);
			sig += `|${v.id}:${opacity.toFixed(3)}`;
		}
		return sig;
	}

	// SECOND, lightweight tick effect: re-target ONLY the vehicle layer on the
	// shared clock so the silence fade advances between polls. Under reduced
	// motion the clock ticks calmly (~30s) and we re-feed discrete opacity — no
	// per-frame ramp. Re-targets via the SAME tickKey so the in-flight position
	// tween is preserved (no motion restart), only opacity is refreshed.
	$effect(() => {
		// ONLY serverNow (+ the layer-install revision) is a tracked dependency, so
		// this effect fires on the clock tick and after a style swap — NOT on every
		// filter/selection change (the main effect above already handles those). All
		// other reads are untracked.
		const serverNow = sharedClock.serverNow;
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		layerRevision;
		untrack(() => {
			const m = map;
			if (!m || !vehicleMotion) return;
			const reduceMotion = isPrefersReducedMotion();
			// Short-circuit: if no vehicle's opacity bucket changed since the last
			// re-feed (every bus still fresh or still floored), the rebuilt
			// FeatureCollection would be byte-identical — skip the rebuild + setData.
			// A bus crossing into / fading within the silence window changes the
			// signature (opacity is quantised finely enough to move every tick mid-
			// fade), so correctness is preserved: that bus still updates. The
			// lastSilenceSignature reset on (re)install guarantees the first
			// post-style-swap tick always feeds.
			const signature = silenceSignature(serverNow, reduceMotion);
			if (signature === lastSilenceSignature) return;
			lastSilenceSignature = signature;
			vehicleMotion.set(
				toVehicleFeatures(
					live.vehicles?.vehicles ?? [],
					filters.state,
					alertVehicleIds,
					selectedVehicleId,
					hoveredVehicleId,
					{ serverNow, ttlS: liveTtl, reduceMotion },
				),
				{
					tickKey: live.vehicles?.generated_utc ?? live.generatedUtc,
					stale: live.isStale,
					refreshOpacity: reduceMotion ? undefined : refreshSilenceOpacity,
				},
			);
		});
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

	// Track the live width of the map stage pane (the left pane) so the fit padding
	// fractions follow the actual — shrinking — map container, not the full hero.
	$effect(() => {
		const node = mapStagePaneEl;
		if (!node || typeof ResizeObserver === 'undefined') return;

		const observer = new ResizeObserver(([entry]) => {
			mapStageWidthPx = entry.contentRect.width;
		});
		observer.observe(node);

		return () => observer.disconnect();
	});
</script>

<!-- The map canvas + its framing vignette. Shared by the desktop pane layout and
     the mobile full-bleed layout so there is exactly ONE MapStage (one GL
     context, one onready). On desktop it lives in the LEFT resizable pane so it
     physically shrinks when the right detail pane opens/resizes; MapStage's own
     ResizeObserver then re-fits the GL viewport to the narrower width. -->
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
		basemapLoader={() => getBasemap()}
		{theme}
		center={mapInitialCenter}
		bounds={ISLAND_FIT_BOUNDS}
		maxBounds={MAP_MAX_BOUNDS}
		fitPadding={mapFitPadding}
		onready={onMapReady}
		onstyleload={onMapStyleLoad}
		label={t.mapLabel}
	/>

	<!-- Edge framing: a token-driven vignette so the full-bleed canvas reads as a
	     deliberate composition (panes float over it) rather than a raw GL square. -->
	<div class="map-vignette" aria-hidden="true"></div>
{/snippet}

{#snippet detailPanel()}
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
{/snippet}

<div
	class="map-hero"
	bind:clientWidth={mapWidthPx}
	style={`--map-detail-offset: ${mapDetailOffset}`}
>
	<!-- ONE cohesive horizontal split, ALWAYS rendered — the map IS the single left
	     pane so dragging the handle resizes it. The pane group is NOT gated on
	     isDesktop: that kept MapStage in exactly one DOM position across the 1024px
	     breakpoint, so crossing it never tears down + recreates the GL context
	     (which would re-fire onready, re-bake sprites, and reload the basemap). On
	     mobile the group is just the single full-width map pane (no handle); the
	     detail rides the BottomSheet below. On desktop, opening a selection mounts
	     the handle + right detail pane (paneforge re-layouts the added pane). Same
	     ui/resizable primitives as AppShell. -->
	<ResizablePaneGroup direction="horizontal" class="map-pane-group">
		<ResizablePane class="map-stage-pane" order={1} bind:ref={mapStagePaneEl}>
			{@render mapBody()}
		</ResizablePane>
		{#if layout.isDesktop && detailOpen}
			<ResizableHandle withHandle class="map-detail-resize-handle" />
			<ResizablePane
				bind:this={rightPanelPane}
				class="map-detail-pane"
				order={2}
				defaultSize={railSizing.defaultSize}
				minSize={railSizing.minSize}
				maxSize={railSizing.maxSize}
				collapsible
				collapsedSize={railSizing.collapsedSize}
				onCollapse={() => (rightPanelCollapsed = true)}
				onExpand={() => (rightPanelCollapsed = false)}
			>
				{@render detailPanel()}
			</ResizablePane>
		{/if}
	</ResizablePaneGroup>

	<!-- Top-left: map title. A mono kicker overline + live freshness ride above a
	     confident heading; a hairline accent rule anchors the block to the edge. -->
	<div class="map-overlay map-head">
		<div class="map-kicker-row">
			<p class="map-kicker">{t.kicker}</p>
			<MapFreshness
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

	<MapFreshness
		placement="floating"
		generatedUtc={live.generatedUtc}
		ageSeconds={live.ageSeconds}
		isStale={live.isStale}
		{locale}
	/>

	<!-- Live-feed edge notice: a small, non-blocking pill centred near the top of
	     the canvas when the live feed is unreachable or currently has no vehicles.
	     It floats OVER the map (pointer-events: none) so the basemap, stops, and
	     near-me stay fully usable; it is not a boundary and never blanks the canvas. -->
	{#if liveEdgeMessage}
		<div
			class="map-overlay map-live-edge"
			data-state={liveEdgeState}
			role="status"
			aria-live="polite"
		>
			{liveEdgeMessage}
		</div>
	{/if}

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

	<!-- Mobile: the detail rides a bottom sheet (the desktop detail lives in the
	     right resizable pane above). -->
	{#if detailOpen && !layout.isDesktop}
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
</div>

<style>
	.map-hero {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--background);
		/* The live offset is driven by the inline `style` binding above
		   (mapDetailOffset = the measured rail width on desktop, else 0rem); the
		   fallback keeps left/right chrome anchored before the first measure. */
		--map-detail-offset: 0rem;
	}
	.map-hero :global(.map-stage) {
		border-radius: 0;
	}

	/* The map+detail split is the BASE layer of the hero: it fills the canvas and
	   sits beneath every floating overlay (vignette z-5, overlays z-10+). The left
	   pane holds the map (so it shrinks with the handle); the right pane holds the
	   detail. paneforge gives each pane height; the stage pane just needs to fill it. */
	.map-hero :global(.map-pane-group) {
		position: absolute;
		inset: 0;
		z-index: 1;
	}
	.map-hero :global(.map-stage-pane) {
		position: relative;
		height: 100%;
		min-width: 0;
		overflow: hidden;
		/* The left pane already PHYSICALLY shrinks away from the right detail pane,
		   so MapStage (rendered inside it) must NOT re-offset its bottom-right
		   attribution by the detail width — that double-counts and floats the credit
		   a panel-width off the map's own right edge while over-constraining its
		   max-width. Resetting the inherited offset to 0 here pins the credit flush
		   to the map's bottom-right (right: 1rem, max-width: 100vw - 1.5rem) whether
		   the detail pane is open, collapsed, or closed. */
		--map-detail-offset: 0rem;
	}

	/* Full-bleed framing: an inset vignette grounds the floating panes against the
	   live canvas and feathers the top/edges so overlay text stays legible over
	   busy basemap tiles, without recolouring the map. Tuned per theme via the
	   --foreground token so it darkens on dark and lightly mutes on cool-slate. */
	.map-vignette {
		position: absolute;
		inset: 0;
		z-index: 5;
		pointer-events: none;
		background:
			linear-gradient(
				to bottom,
				color-mix(in srgb, var(--background) 34%, transparent) 0%,
				transparent 18%,
				transparent 86%,
				color-mix(in srgb, var(--background) 24%, transparent) 100%
			),
			radial-gradient(
				120% 90% at 50% 42%,
				transparent 58%,
				color-mix(in srgb, var(--foreground) 7%, transparent) 100%
			);
	}

	.map-overlay {
		position: absolute;
		z-index: 10;
	}
	.map-head {
		top: 1.15rem;
		left: calc(var(--app-left-rail-offset, 0rem) + 1rem);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-left: 0.85rem;
		/* Hairline accent rule anchors the title to the canvas edge — font as
		   architecture: a single vertical brand stroke instead of a chrome box. */
		border-left: 2px solid var(--border-rule);
		max-width: calc(
			100% - var(--app-left-rail-offset, 0rem) - var(--map-detail-offset, 0rem) - 2rem
		);
	}
	.map-kicker-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}
	.map-kicker {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
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
		font-size: var(--text-heading);
		letter-spacing: -0.01em;
		line-height: 0.95;
		color: var(--foreground);
		/* Faint legibility lift so the heading survives over busy basemap tiles;
		   the colour-mix keeps it theme-correct (dark halo on dark, light on light). */
		text-shadow: 0 1px 16px color-mix(in srgb, var(--background) 70%, transparent);
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
		bottom: 1.15rem;
		z-index: 24;
		max-width: min(20rem, calc(100% - 2rem));
		padding: 0.85rem 0.9rem;
		background: color-mix(in srgb, var(--card) 92%, transparent);
		border: 1px solid var(--border-hairline);
		border-top: 2px solid var(--border-rule);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		/* The card is already ~92% opaque, so the blur barely shows through; keep
		   it modest (10px, in line with the rest of the chrome) since this peek
		   floats over the constantly-repainting live canvas — a heavier blur is
		   pure compositing cost on the busiest overlay for no visible gain. */
		backdrop-filter: blur(10px) saturate(1.05);
		pointer-events: none;
	}
	/* Live-feed edge notice: a calm, centred pill near the top of the canvas. Token-
	   driven (card surface + hairline + blur, like the rest of the floating chrome),
	   non-interactive (it states a fact; it does not block the map). Centred between
	   the left rail and the right detail offset so it never hides behind a pane. */
	.map-live-edge {
		top: 1.15rem;
		left: calc(var(--app-left-rail-offset, 0rem) / 2 + var(--map-detail-offset, 0rem) / 2);
		right: 0;
		margin-inline: auto;
		z-index: 12;
		width: max-content;
		max-width: min(26rem, calc(100% - 2rem));
		padding: 0.45rem 0.85rem;
		text-align: center;
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--card) 88%, transparent);
		border: 1px solid var(--border-hairline);
		border-top: 2px solid var(--border-rule);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(10px) saturate(1.05);
		pointer-events: none;
	}
	/* The feed-down state warms the border with the caution hue (a data verdict),
	   echoing the stale-freshness chrome; the text still carries the meaning. */
	.map-live-edge[data-state='unavailable'] {
		border-top-color: color-mix(in srgb, var(--dataviz-status-late) 48%, var(--border-rule) 52%);
	}

	/* B1 — the right rail pane carries a HARD rem clamp so the EXPANDED rail has a
	   genuinely narrow floor (22rem) and a real ceiling (34rem), independent of the
	   percent paneforge layouts it with. The percent minSize/maxSize (derived from
	   these exact rems at the live hero width) stop the drag at the same pixel, so
	   the clamp and the percent never fight; the clamp only has to bite during the
	   brief pre-measure frame. It is REMOVED while collapsed (paneforge sets
	   data-collapsed) so the thin 3.7rem icon strip is not forced back to 22rem. */
	:global(.map-detail-pane:not([data-collapsed])) {
		min-width: 22rem;
		max-width: 34rem;
	}

	.map-detail-panel-frame {
		height: 100%;
		min-width: 0;
		/* Casts the panel against the map edge so the split reads as a layer over
		   the canvas, not a seam in it. */
		box-shadow: var(--shadow-section);
	}
	/* The resize grip: a calm rail at rest that warms to brand on
	   hover/focus/drag. The rail is a hairline; the withHandle child becomes a
	   slim centred pill (not a chunky bar). */
	:global(.map-detail-resize-handle) {
		width: 8px;
		pointer-events: auto;
		background: var(--border-hairline);
		transition: background var(--duration-fast, 150ms) var(--ease-default, ease);
	}
	:global(.map-detail-resize-handle > div) {
		height: 2.25rem;
		width: 2px;
		border-radius: var(--radius-pill);
		background: var(--border-strong);
		transition:
			background var(--duration-fast, 150ms) var(--ease-default, ease),
			height var(--duration-fast, 150ms) var(--ease-default, ease);
	}
	:global(.map-detail-resize-handle:hover),
	:global(.map-detail-resize-handle:focus-visible),
	:global(.map-detail-resize-handle[data-active='pointer']) {
		background: color-mix(in srgb, var(--primary) 16%, transparent);
	}
	:global(.map-detail-resize-handle:hover > div),
	:global(.map-detail-resize-handle:focus-visible > div),
	:global(.map-detail-resize-handle[data-active='pointer'] > div) {
		height: 3rem;
		background: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.mf-chip) {
			transition: none;
		}
		:global(.map-detail-resize-handle),
		:global(.map-detail-resize-handle > div) {
			transition: none;
		}
	}

	@media (max-width: 760px) {
		.map-head {
			top: 0.75rem;
			left: 0.75rem;
			right: 0.75rem;
			padding-left: 0.7rem;
			max-width: calc(100% - 1.5rem);
		}
		.map-heading {
			font-size: var(--text-subheading);
		}
		.map-filter-panel {
			display: none;
		}
		.map-peek {
			display: none;
		}
	}
</style>
