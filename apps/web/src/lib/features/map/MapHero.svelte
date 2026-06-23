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
	import { layout, isDesktopViewport } from '$lib/nav';
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
		type FixResolver,
		type Coord,
	} from '$lib/components/map';
	import {
		bestShapeForPoint,
		routeShapes,
		type RouteShapes,
	} from '$lib/components/map/vehicleShapes';
	import { liveTtlS } from '$lib/components/map/vehicleSilence';
	import { fixAgeS, isVehicleStale } from '$lib/components/map/vehicleProjection';
	import { sharedClock, motionMode } from '$lib/stores';
	import { isPrefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import MapFilters from './MapFilters.svelte';
	import MapFilterPill from './MapFilterPill.svelte';
	import MapFreshness from './MapFreshness.svelte';
	import MapFeedStallBanner from './MapFeedStallBanner.svelte';
	import MapNearMeControl from './MapNearMeControl.svelte';
	import MapMotionControl from './MapMotionControl.svelte';
	import MapSelectionDetail from './MapSelectionDetail.svelte';
	import { routeBoundsFromFile, zoomForNearMePrecision } from './mapGeo';
	import { motionFeedAnimate } from './motionFeed';
	import { parseCoordinateQuery, nearTargetKey } from './mapNearMe';
	import { copy as MAP_COPY } from './map.copy';
	import {
		readStoredDetailPanelWidth,
		writeStoredDetailPanelWidth,
		clampDetailPanelWidth,
		MIN_DETAIL_PANEL_WIDTH,
		MAX_DETAIL_PANEL_WIDTH,
	} from './mapDetailPanes';
	import { shouldAnimate } from '$lib/motion/policy';
	import { buildAlertEntitySets, vehicleHasAlert } from './mapAlerts';
	import { PICKABLE_MAP_LAYERS, pickMapSelection } from './mapPicking';
	import {
		resolveMapSelection,
		type MapSelection,
		type MapSelectionDetail as MapSelectionDetailValue,
	} from './mapSelection';
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

	// Hero width — window-reactive ONLY. The fit-padding fraction math runs off the
	// WHOLE-HERO clientWidth. The map is full-bleed (it fills the hero), and every
	// panel OVERLAYS it (absolute), so dragging or collapsing a panel never changes
	// the hero width — the fit padding stays STABLE and MapStage's fitPadding effect
	// never re-fits. Only a genuine viewport resize changes mapWidthPx. Seeded with a
	// desktop default so the fraction padding applies even before the first
	// clientWidth measurement (a 0 here would fall back to the wide fit).
	let mapWidthPx = $state(1280);
	const fitWidthPx = $derived(mapWidthPx);

	// Layout snapshot for the CAMERA-AFFECTING derivation (mapFitPadding). Resolved
	// ONCE up front from matchMedia (`isDesktopViewport()`, SSR-safe → false on the
	// server) and refreshed only on a GENUINE viewport resize in onMount — NOT off the
	// shared `layout.isDesktop` store. The store flips false→true during hydration (it
	// reads `false` on the server), and the map's fitPadding effect re-runs fitBounds on
	// any padding change, so deriving the padding off that store would re-fit and SHIFT
	// the camera on the first paint. A matchMedia read at init is already the real value
	// client-side, so the very first padding is correct and the camera fits once. The
	// store still drives the non-camera chrome branches below (hover peek, the detail
	// pane gate, motion control).
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

	// Desktop frames the island into a roughly SQUARE central gap with generous
	// left/right BUFFERS sized as a fraction of the width. The buffers (a) crop the
	// off-island east (south-shore sprawl), (b) keep the whole island visible past
	// the left filter panel and the right detail panel at their furthest, and
	// (c), being static, never shift the map when a panel toggles. The island
	// sits centred in the visible gap: human-centred, not math-centred on the full
	// canvas. Tunable knobs:
	const DESKTOP_LEFT_PAD_FRAC = 0.37; // clears rail + filter panel, with band
	const DESKTOP_RIGHT_PAD_FRAC = 0.43; // buffer for the right detail panel + band
	const DESKTOP_VERT_PAD_PX = 56; // small top/bottom → island fills the height (bigger)
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
	let detailDragStartX = 0;
	let detailDragStartWidth = 0;
	const detailResizeAria = $derived(t.detailResizeLabel);
	// Reads the one-shot `isDesktopLayout` snapshot (not the hydration-flipping store)
	// so the FIRST padding is already correct and the camera fits exactly once.
	const mapFitPadding = $derived<MapFitPadding>(
		isDesktopLayout && fitWidthPx > 0
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

	// Keep the shared clock ticking while the map is mounted: every relative-time
	// label (the freshness chip, the feed-stall banner age) re-derives off
	// `sharedClock.serverNow`, so it must keep advancing between polls. (This once
	// also drove the per-vehicle silence fade, now removed — buses are solid.)
	$effect(() => sharedClock.subscribe());

	// Tear the motion controller down on component unmount: it owns a running rAF
	// projection loop, which is otherwise only stopped inside installMapLayers when
	// the MAP instance changes — so navigating away from /map would leak a live
	// loop. This effect has no tracked reads, so it runs once and its cleanup fires
	// only on unmount; it reads vehicleMotion lazily there to stop whatever
	// controller is current. The map-instance-change path is unaffected: it destroys
	// the OLD controller before creating a new one, so there is no double destroy
	// (destroy() just cancels an already-cancelled loop, which is a no-op).
	$effect(() => () => untrack(() => vehicleMotion)?.destroy());

	// Live tier ttl (seconds) → drives the global stale/banner windows (isStale fires
	// at 3x ttl = 90s) AND sizes the per-bus not-reporting cutoff (threaded as `ttlS`
	// into toVehicleFeatures, where a bus whose own reported_utc fix is past the window
	// freezes + earns the "!" badge). Default 30s if the manifest omits it.
	const liveTtl = liveTtlS(manifest.files?.live?.ttl_s);

	let map = $state<MapLibreMap | null>(null);
	let vehicleMotion = $state<VehicleMotionController | null>(null);
	let vehicleMotionMap: MapLibreMap | null = null;

	// --- forward-projection shape supply --------------------------------------
	// Per-route direction-variant polylines, fetched on-demand for the routes that
	// currently have live buses (deduped by route id — far fewer than the ~600
	// vehicles). Loaded through the same getRoute() path as the selected-route
	// linework, then cached so a route is fetched at most once. The controller's
	// per-frame `shapeFor` reads this to project a bus FORWARD along its street;
	// until a shape resolves the bus FREEZES at its fix (we never dead-reckon on the
	// raw bearing). A newly-cached shape is therefore picked up on the very next
	// rAF frame — no re-feed needed, so this stays a PLAIN (non-reactive) Map. A
	// SvelteMap would make every .set() reactive and thrash the feed effect.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const routeShapeCache = new Map<string, RouteShapes>();
	// Routes already fetched (or null/empty result cached) so we never re-request.
	// Plain Set for the same reason — a dedupe ledger, not reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const routeShapeRequested = new Set<string>();
	// Cap distinct cached routes to bound memory over a long session; the visible
	// set is small, so eviction is rare. LRU-ish: oldest insertion dropped first.
	const MAX_CACHED_ROUTE_SHAPES = 200;

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
	// network service-span signal we do not yet publish. The selected-but-silent
	// "last seen N ago" half is also DEFERRED: it needs a per-vehicle report
	// timestamp in /v1, but updated_utc is currently the uniform snapshot capture
	// time (every vehicle shares it), so it can only express global staleness, not
	// one stuck bus.
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
	// Per-bus stale-GPS note. PR-A gives each vehicle its OWN fix time (reported_utc,
	// nullable → updated_utc fallback), so we can now honestly flag ONE silent bus
	// (its fix older than STALE_CUTOFF_S) without the old global-snapshot caveat. For
	// a focused VEHICLE detail, age it on its own fix vs the shared clock; return
	// { ageS } only when stale, else null (no note). Reads sharedClock.serverNow so
	// the note appears/refreshes as a bus crosses the cutoff between polls.
	function vehicleAbsence(
		detail: MapSelectionDetailValue | null,
		serverNow: number,
	): { ageS: number } | null {
		if (detail?.kind !== 'vehicle') return null;
		const ageS = fixAgeS(detail.vehicle.reported_utc, detail.vehicle.updated_utc, serverNow);
		return isVehicleStale(ageS) ? { ageS } : null;
	}
	const selectedVehicleAbsence = $derived(vehicleAbsence(selectedDetail, sharedClock.serverNow));
	const hoverVehicleAbsence = $derived(vehicleAbsence(hoverDetail, sharedClock.serverNow));
	const detailSurfaceKey = $derived(
		selectedDetail ? `${selectedDetail.kind}:${selectedDetail.id}` : 'empty',
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
		// A fresh pick always shows its detail: if the panel was sitting collapsed in
		// the icon strip, expand it so the new selection is visible, never stranded.
		detailCollapsed = false;
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
		// Re-open the panel expanded next time: a closed panel should not remember a
		// collapsed strip (that would re-open as an empty rail with no obvious content).
		detailCollapsed = false;
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
		// A fresh pick always shows its detail: expand the panel if it was collapsed.
		detailCollapsed = false;
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
		// Bump so the feed effect re-runs and re-pushes the vehicle/stop/route data
		// MapLibre cleared from its custom sources on the style swap.
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

	// Lazily fetch route shapes for the routes that currently have live buses
	// (deduped). Runs off the vehicles poll only (other reads untracked) so a
	// filter/hover does not re-trigger fetches. Each route is requested at most
	// once; a resolved shape is dropped into `routeShapeCache`, which the
	// controller's per-frame `shapeFor` reads — so that route's buses upgrade from
	// frozen to FORWARD projection on the next rAF frame, no re-feed needed. Fetches
	// are fire-and-forget + fail-soft (a failed/absent shape simply leaves the bus
	// frozen at its fix — never blocks). We do NOT bulk-fetch all routes: only the
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
					})
					.catch(() => {
						// Fail-soft: leave the route un-cached → chord fallback. Allow a
						// later retry by clearing the requested flag.
						routeShapeRequested.delete(id);
					});
			}
		});
	});

	// Per-vehicle route-shape resolver passed into the motion controller. For a
	// vehicle feature, return the cached route-shape variant its CURRENT point sits
	// on (least projection error), or null → FREEZE (no shape ⇒ no forward dead-
	// reckoning; we never project on the raw GTFS-RT bearing). Read EACH FRAME by
	// the controller (a cheap cache lookup), so a route shape that resolves mid-
	// flight upgrades the bus from frozen to projected without waiting for a re-feed.
	const shapeFor: ShapeResolver = (feature) => {
		const routeId = feature.properties.route;
		if (!routeId) return null;
		const shapes = routeShapeCache.get(routeId);
		if (!shapes || shapes.length === 0) return null;
		return bestShapeForPoint(shapes, feature.geometry.coordinates as Coord);
	};

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

	// Feed the layers: vehicles coloured/dimmed under the active filter + the stop
	// catalogue; dim on stale. Reactive to filters.state so a chip toggle re-paints.
	// Forward projection is now CLOCK-DRIVEN inside the controller's rAF loop (it
	// reads serverNowFn each frame and projects each bus from its own latest fix to
	// estimated-now), so this effect only re-feeds the latest FILES + filter/
	// selection — it does NOT need to fire on the per-second clock tick.
	$effect(() => {
		const m = map;
		// Reading `layerRevision` registers the post-style-swap layer install as an
		// effect dependency, so data is re-fed after MapLibre clears custom sources.
		// (A resolved route shape needs NO re-feed: the controller's per-frame
		// shapeFor reads routeShapeCache directly and upgrades buses on the next frame.)
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		layerRevision;
		if (!m) return;
		const reduceMotion = isPrefersReducedMotion();
		// Smooth = forward-projection ("almost real-time"); raw = ping-on-load (snap
		// every feed, no estimation), the honest default. Reading motionMode.current
		// here registers it as an effect dependency so flipping the toggle re-feeds
		// and the controller switches between project and snap without a poll.
		const smoothMotion = motionMode.current === 'smooth';
		const animate = motionFeedAnimate({ smoothMotion, reduceMotion });
		setRouteLines(m, routeLineRoutes, selectedRouteLine);
		// serverNow read UNTRACKED here so this poll/filter/selection effect is NOT
		// re-run by the per-second clock tick (the controller's rAF loop advances
		// projection between polls). Used only to bake the feed-time silenceAgeS prop.
		const serverNow = untrack(() => sharedClock.serverNow);
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
				tickKey: live.vehicles?.generated_utc ?? live.generatedUtc,
				stale: live.isStale,
				// FORWARD projection: speed + fix-time per bus, the route shape to walk,
				// and the LIVE skew-free clock read each frame so the dot tracks
				// estimated-NOW. Reduced motion / global stale / RAW mode snap to reported
				// positions (animate=false inside the controller), so these are inert there.
				fixFor,
				shapeFor: animate ? shapeFor : undefined,
				serverNowFn: () => sharedClock.serverNow,
				// animate = smooth mode AND motion-gated allowed (reduced-motion off). In
				// raw mode the controller SNAPS each ~30s feed (ping-on-load, no estimate).
				animate,
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
			return;
		}
		if (selected && !selectedDetail) {
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
		el.style.setProperty('--app-right-detail-offset', `${detailWidthPx}px`);
		const chromeOffset =
			layout.isDesktop && detailOpen ? (detailCollapsed ? '3.7rem' : `${detailWidthPx}px`) : '0rem';
		el.style.setProperty('--map-detail-offset', chromeOffset);
	});

	// Collapse/expand the right detail panel. A pure local toggle: it flips
	// `data-detail-collapsed` on .map-hero, which the CSS reads to slide the overlay
	// OFF the right edge (collapses to the RIGHT, never to the left / mid-air). The
	// selection stays alive so expanding restores the same detail.
	function toggleDetailCollapsed(): void {
		detailCollapsed = !detailCollapsed;
	}

	// Pointer-drag the detail panel's LEFT edge to resize its width. Capturing the
	// pointer keeps the drag tracking even if the cursor leaves the handle; each move
	// writes a CLAMPED width into the CSS var (so the overlay follows live), and we
	// persist on release. Dragging the LEFT edge GROWS the panel as the pointer moves
	// left, so the delta is negated. The map canvas is untouched throughout — it never
	// reads the panel width. Mirrors the AppShell left-rail drag exactly.
	function onDetailHandlePointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		detailDragging = true;
		detailDragStartX = event.clientX;
		detailDragStartWidth = detailWidthPx;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function onDetailHandlePointerMove(event: PointerEvent): void {
		if (!detailDragging) return;
		// Left-edge handle: moving the pointer left (negative delta) widens the panel.
		detailWidthPx = clampDetailPanelWidth(
			detailDragStartWidth - (event.clientX - detailDragStartX),
		);
	}

	function onDetailHandlePointerUp(event: PointerEvent): void {
		if (!detailDragging) return;
		detailDragging = false;
		(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
		writeStoredDetailPanelWidth(detailWidthPx);
	}

	// Keyboard resize for the separator (a11y parity with the left-rail handle): arrows
	// nudge the width, Home/End jump to the floor/ceiling. Left-edge handle, so Left
	// grows and Right shrinks. Persists on each commit.
	function onDetailHandleKeyDown(event: KeyboardEvent): void {
		const STEP = 16;
		let next: number;
		switch (event.key) {
			case 'ArrowLeft':
				next = detailWidthPx + STEP;
				break;
			case 'ArrowRight':
				next = detailWidthPx - STEP;
				break;
			case 'Home':
				next = MAX_DETAIL_PANEL_WIDTH;
				break;
			case 'End':
				next = MIN_DETAIL_PANEL_WIDTH;
				break;
			default:
				return;
		}
		event.preventDefault();
		detailWidthPx = clampDetailPanelWidth(next);
		writeStoredDetailPanelWidth(detailWidthPx);
	}
</script>

<!-- The map canvas + its framing vignette. The hero renders exactly ONE MapStage
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
	<RightPanel
		{locale}
		title={selectedDetail?.title}
		surfaceKey={detailSurfaceKey}
		canGoBack={selectionStack.length > 0}
		onback={goBackDetail}
		onclose={closeDetail}
		collapsed={detailCollapsed}
		ontogglecollapse={toggleDetailCollapsed}
		resizable
	>
		{#if selectedDetail}
			<MapSelectionDetail
				detail={selectedDetail}
				{locale}
				notReporting={selectedVehicleAbsence}
				onselect={selectFromDetail}
				onfilter={applyDetailFilter}
				onalertselect={selectAlertRelated}
			/>
		{/if}
	</RightPanel>
{/snippet}

<!-- The unified Controls panel — ONE source of truth shared by the desktop
     overlay AND the mobile drawer (MapFilterPill). It is MapFilters in
     controlsMode (titled "Controls") with the inline motion toggle pinned to its
     top via the `motionHeader` snippet. Rendering the SAME snippet on both
     breakpoints keeps the desktop panel and the mobile drawer identical — no
     divergent call sites. -->
{#snippet motionHeader(collapsed: boolean)}
	<MapMotionControl {locale} copy={t} {collapsed} />
{/snippet}
{#snippet mapControls(opts?: { collapsible?: boolean; onselect?: () => void })}
	<MapFilters
		store={filters}
		{locale}
		routes={routesIndex.data?.routes ?? []}
		stops={stops.data?.stops ?? []}
		collapsible={opts?.collapsible ?? true}
		controlsMode={true}
		header={motionHeader}
		onselect={opts?.onselect}
	/>
{/snippet}

<!-- The map SURFACE — the full-bleed canvas plus every floating overlay (title,
     near-me, Controls panel, freshness, feed-stall, live-edge, hover peek). It fills
     the whole hero (inset:0). The right-edge chrome (near-me, peek, freshness) reads
     --map-detail-offset so it shifts clear of the open detail overlay. Rendered ONCE,
     so the GL context is stable. -->
{#snippet mapSurface()}
	<div class="map-surface">
		{@render mapBody()}

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

		<!-- Left: the unified Controls panel (URL-driven filters + the motion toggle).
		     The motion-mode switch (raw vs almost-real-time, bound to the motionMode
		     store) is pinned to the TOP of the panel via the shared `mapControls`
		     snippet; the combinable state filters sit below. Desktop renders it here;
		     mobile renders the SAME snippet inside MapFilterPill's drawer (one source
		     of truth, no divergent call sites). There is no separate floating chip,
		     so nothing reflows when the toggle swaps raw⇄smooth. -->
		<div class="map-overlay map-filter-panel">
			{@render mapControls()}
		</div>

		<MapFilterPill store={filters} {locale} hidden={detailOpen} controls={mapControls} />

		<MapFreshness
			placement="floating"
			generatedUtc={live.generatedUtc}
			ageSeconds={live.ageSeconds}
			isStale={live.isStale}
			{locale}
		/>

		<!-- Feed-stall banner: a calm top-of-map caution shown ONLY when the WHOLE live
		     feed has genuinely stalled (live.isStale — age past the 3x-ttl budget). The
		     pipeline stamps every vehicle's updated_utc with the uniform snapshot capture
		     time, so THIS banner is a GLOBAL feed signal, never one stuck bus — which is why
		     the per-vehicle silence FADE (that keyed off the uniform updated_utc) was
		     dropped. A per-bus not-reporting "!" badge was RE-ADDED, but off each bus's OWN
		     reported_utc (its GTFS-RT GPS fix time), which IS per-vehicle — see liveTtl /
		     toVehicleFeatures. Informational (a polite status), non-blocking, absent in
		     normal operation. -->
		<MapFeedStallBanner
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
					notReporting={hoverVehicleAbsence}
					onselect={selectFromDetail}
					onfilter={applyDetailFilter}
					onalertselect={selectAlertRelated}
				/>
			</div>
		{/if}
	</div>
{/snippet}

<div class="map-hero" bind:this={heroEl} bind:clientWidth={mapWidthPx}>
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
	     mounted while a back target resolves. -->
	{#if layout.isDesktop && detailOpen}
		<div
			class="map-detail-overlay"
			data-slot="map-detail-overlay"
			data-detail-collapsed={detailCollapsed ? 'true' : undefined}
			data-detail-dragging={detailDragging ? 'true' : undefined}
		>
			<!-- Left-edge resize handle — a thin col-resize strip that DRAGS the panel's
			     width into the CSS var (overlay follows; the map canvas never reads it, so
			     it is never resized). role="separator" + keyboard nudges match the left-rail
			     handle's a11y. Absent while collapsed (the icon strip is fixed-width). -->
			{#if !detailCollapsed}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="map-detail-handle"
					data-slot="map-detail-handle"
					role="separator"
					aria-orientation="vertical"
					aria-label={detailResizeAria}
					aria-valuemin={MIN_DETAIL_PANEL_WIDTH}
					aria-valuemax={MAX_DETAIL_PANEL_WIDTH}
					aria-valuenow={detailWidthPx}
					tabindex="0"
					onpointerdown={onDetailHandlePointerDown}
					onpointermove={onDetailHandlePointerMove}
					onpointerup={onDetailHandlePointerUp}
					onpointercancel={onDetailHandlePointerUp}
					onkeydown={onDetailHandleKeyDown}
				></div>
			{/if}
			{@render detailPanel()}
		</div>
	{/if}

	<!-- Mobile: the detail rides a bottom sheet (the desktop detail lives in the
	     right overlay above). -->
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
					notReporting={selectedVehicleAbsence}
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
		/* The width of the RIGHT DETAIL overlay, written live by the drag handle into
		   --app-right-detail-offset. The floating map chrome (near-me, peek, freshness,
		   attribution) reads --map-detail-offset to shift clear of the open panel; it
		   resolves to 0 when the detail is closed or collapsed (the overlay is gone /
		   off the edge), so chrome sits flush to the map's own right edge again. The
		   MAP CANVAS never reads either var, so resizing the panel can not resize it. */
		--app-right-detail-offset: 360px;
		--map-detail-offset: 0rem;
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
	.map-surface :global(.map-hero-stage) {
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: 0;
	}

	/* RIGHT DETAIL overlay — absolutely positioned, anchored FLUSH to the map's right
	   edge, its width the live --app-right-detail-offset CSS var. It floats OVER the
	   map; only the overlay itself takes pointer events, so the map underneath stays
	   interactive. Its box-shadow lives here so the lift vanishes WITH the overlay when
	   the detail closes (the overlay only exists while detailOpen). COLLAPSED slides it
	   OFF the right edge by translating the leftover strip beyond 100% width. */
	.map-detail-overlay {
		position: absolute;
		inset-block: 0;
		right: 0;
		z-index: 32;
		width: var(--app-right-detail-offset);
		max-width: 100%;
		box-shadow: var(--shadow-section);
		pointer-events: auto;
		transition: width var(--duration-normal, 180ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}
	/* Suppress the width transition WHILE dragging so the panel tracks the pointer 1:1;
	   it re-applies for the collapse/expand snap. */
	.map-detail-overlay[data-detail-dragging='true'] {
		transition: none;
	}
	/* COLLAPSED to the RIGHT: the RightPanel inside shrinks to its 3.7rem icon strip
	   (data-open='false'), so the overlay box narrows to that strip flush at the right
	   edge — collapsed to the right edge, never to the left / mid-air. The strip stays
	   on-screen so the expand toggle is reachable. */
	.map-detail-overlay[data-detail-collapsed='true'] {
		width: 3.7rem;
	}

	/* The detail panel's left-edge resize handle — a thin col-resize strip flush to the
	   overlay's leading edge, matching the left-rail handle tone (idle --border,
	   hover/active --primary). Mirrors .app-shell-rail-handle. */
	.map-detail-handle {
		position: absolute;
		inset-block: 0;
		left: 0;
		width: 6px;
		z-index: 1;
		cursor: col-resize;
		background: var(--border);
		opacity: 0;
		transition:
			opacity var(--duration-fast, 140ms) var(--ease-default, ease),
			background var(--duration-fast, 140ms) var(--ease-default, ease);
		touch-action: none;
	}
	.map-detail-overlay:hover .map-detail-handle,
	.map-detail-handle:hover,
	.map-detail-handle:focus-visible,
	.map-detail-overlay[data-detail-dragging='true'] .map-detail-handle {
		opacity: 1;
	}
	.map-detail-handle:hover,
	.map-detail-handle:focus-visible,
	.map-detail-overlay[data-detail-dragging='true'] .map-detail-handle {
		background: var(--primary);
	}
	.map-detail-handle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
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

	@media (prefers-reduced-motion: reduce) {
		:global(.mf-chip) {
			transition: none;
		}
		.map-detail-overlay,
		.map-detail-handle {
			transition: none;
		}
	}

	/* Below the single map breakpoint (1024px = layout.isDesktop) the unified
	   Controls panel hides and the floating Controls pill takes over (it gates
	   itself to < 1024px). Keeping the panel-hide on the SAME 1024 line as the
	   pill-hide and the JS `layout.isDesktop` snapshot means all three agree — no
	   dead 760px band where the panel and pill could both show or both vanish.
	   The compact phone-style head (smaller heading, edge-anchored) also rides this
	   line so narrower viewports get the mobile chrome wholesale. .map-peek is
	   already `layout.isDesktop`-gated in markup; the hide here is belt-and-braces. */
	@media (max-width: 1023px) {
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
