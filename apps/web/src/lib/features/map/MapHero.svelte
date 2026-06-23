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

	// Hero width — window-reactive ONLY (not panel state). The map is now full-bleed
	// and never resizes when the detail panel opens (the panel FLOATS over it), so the
	// fit-padding fraction math runs straight off the hero clientWidth. Seeded with a
	// desktop default so the fraction padding applies even before the first
	// clientWidth measurement (a 0 here would fall back to the wide fit).
	let mapWidthPx = $state(1280);
	const fitWidthPx = $derived(mapWidthPx);

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
	// Fixed width of the floating right detail panel (desktop). The panel OVERLAYS the
	// map (like the left .map-overlay controls) instead of being a resizable pane, so
	// the map never resizes when it opens. Right-anchored chrome (near-me, freshness
	// chip, hover peek) shifts clear of it via the --map-detail-offset variable below.
	const MAP_DETAIL_PANEL_WIDTH_PX = 360;
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

	// Live tier ttl (seconds) → drives the stale/banner windows (isStale fires at
	// 3x ttl = 90s) so they track the publisher's cadence, not a magic number.
	// Default 30s if the manifest omits it. (The per-vehicle silence fade this once
	// also sized is gone; liveTtl is still threaded through the now no-op refresher.)
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
	// Right-anchored chrome (near-me control, floating freshness chip, hover peek)
	// shifts clear of the floating detail panel via this offset. The panel is a FIXED
	// width that OVERLAYS the map (it never resizes the canvas), so this is a constant
	// while open and 0 while closed — no ResizeObserver, no per-frame measurement.
	const mapDetailOffset = $derived(
		detailOpen && layout.isDesktop ? `${MAP_DETAIL_PANEL_WIDTH_PX}px` : '0rem',
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
</script>

<!-- The map canvas + its framing vignette. Rendered FULL-BLEED directly in the
     hero (not inside a resizable pane) so there is exactly ONE MapStage (one GL
     context, one onready) and the map NEVER resizes when the detail panel opens —
     the panel FLOATS over the right slice (like the left .map-overlay controls),
     so MapLibre's ResizeObserver never fires and the camera never jumps. The same
     mapBody renders on every breakpoint, keeping the GL context stable across the
     1024px line. -->
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

<div
	class="map-hero"
	bind:clientWidth={mapWidthPx}
	style={`--map-detail-offset: ${mapDetailOffset}`}
>
	<!-- The map is FULL-BLEED: rendered directly in the hero (not inside a resizable
	     pane) and ALWAYS mounted, never gated on isDesktop — so crossing the 1024px
	     breakpoint keeps MapStage in exactly ONE DOM position and never tears down +
	     recreates the GL context (which would re-fire onready, re-bake sprites, and
	     reload the basemap). The detail panel FLOATS over the right slice (below) so
	     the canvas never resizes when a selection opens — no jump, no zoom-break. -->
	{@render mapBody()}

	<!-- Desktop: the detail FLOATS over the map's right slice as a fixed-width
	     overlay (mirroring the left .map-overlay controls), so opening it never
	     resizes the canvas. ANCHORED FLUSH to the right edge (right: 0) and, when it
	     collapses or narrows, the panel stays pinned right (justify-content: flex-end)
	     instead of drifting to the left of the overlay box — it retracts TO the right
	     edge, never mid-canvas. A labelled dialog region with a close + back control.
	     On mobile the detail rides the BottomSheet below instead. -->
	{#if layout.isDesktop && detailOpen}
		<div
			class="map-overlay map-detail-overlay"
			role="dialog"
			aria-label={selectedDetail?.title ?? t.detailPanelLabel}
		>
			{@render detailPanel()}
		</div>
	{/if}

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

	<!-- Bottom-left: the honest motion-mode switch (raw vs almost-real-time),
	     bound to the motionMode store. DESKTOP ONLY — it floats clear of the
	     bottom-right near-me control and deep-links into the /metrics
	     live-positions explainer. On mobile the same switch rides at the top of
	     the filter sheet (the header snippet below), so the canvas stays clear. -->
	{#if layout.isDesktop}
		<MapMotionControl variant="floating" {locale} copy={t} />
	{/if}

	<!-- Left: the combinable state filter (URL-driven). On mobile the panel
	     doubles as the controls sheet (controlsMode) with the inline motion toggle
	     pinned to its top via the header snippet. -->
	<div class="map-overlay map-filter-panel">
		{#snippet motionHeader()}
			<MapMotionControl variant="inline" {locale} copy={t} />
		{/snippet}
		<MapFilters
			store={filters}
			{locale}
			routes={routesIndex.data?.routes ?? []}
			stops={stops.data?.stops ?? []}
			controlsMode={!layout.isDesktop}
			header={layout.isDesktop ? undefined : motionHeader}
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

	<!-- Feed-stall banner: a calm top-of-map caution shown ONLY when the WHOLE live
	     feed has genuinely stalled (live.isStale — age past the 3x-ttl budget). The
	     pipeline stamps every vehicle's updated_utc with the uniform snapshot capture
	     time, so staleness is a GLOBAL feed signal, never one stuck bus — which is why
	     the per-vehicle silence fade + per-bus marker were dropped. Informational (a
	     polite status), non-blocking, and absent in normal operation. -->
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
		/* The live offset is driven by the inline `style` binding above
		   (mapDetailOffset = the fixed floating-panel width on desktop when open,
		   else 0rem) so right-anchored chrome shifts clear of the panel; the fallback
		   keeps left/right chrome anchored when the panel is closed. */
		--map-detail-offset: 0rem;
	}

	/* The map is the BASE layer of the hero: it fills the canvas FULL-BLEED and sits
	   beneath every floating overlay (vignette z-5, overlays z-10+). It never resizes
	   when the detail panel opens — the panel floats over the right slice. The inline
	   --map-detail-offset inherits in, so MapStage's bottom-right attribution shifts
	   clear of the floating panel instead of hiding beneath it. */
	.map-hero :global(.map-hero-stage) {
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: 0;
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

	/* The detail FLOATS over the map's right slice as a fixed-width overlay (mirroring
	   the left .map-overlay controls), so opening it never resizes the canvas. It owns
	   a comfortable fixed width and its OWN full-height internal scroll (RightPanel's
	   ScrollArea body). ANCHORED FLUSH to the right edge (right: 0, full map height)
	   and `justify-content: flex-end` keeps the RightPanel pinned to that right edge
	   even when it COLLAPSES (360px → the 3.7rem rail): the narrow strip retracts TO
	   the right edge instead of drifting to the left of the overlay box and hanging
	   mid-canvas "in the air". It slides IN/OUT from the right edge (translateX),
	   never leftward; reduced motion gets the resolved state with no slide. A token-
	   driven section shadow lifts it off the live canvas; pointer-events stay on so the
	   panel is interactive while the map underneath keeps repainting. */
	.map-detail-overlay {
		top: 0;
		right: 0;
		bottom: 0;
		width: 360px;
		max-width: calc(100% - var(--app-left-rail-offset, 0rem) - 1rem);
		z-index: 26;
		display: flex;
		justify-content: flex-end;
		box-shadow: var(--shadow-section);
		animation: map-detail-in 220ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
	}

	/* Slide IN from the RIGHT edge (off-canvas right → flush right), never mid-canvas
	   or leftward. The translateX origin is the panel's own width so it tucks fully
	   off the right edge before settling. */
	@keyframes map-detail-in {
		from {
			opacity: 0;
			transform: translateX(100%);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.mf-chip) {
			transition: none;
		}
		/* No slide for the detail overlay under reduced motion: it appears in its
		   resolved flush-right state. */
		.map-detail-overlay {
			animation: none;
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
