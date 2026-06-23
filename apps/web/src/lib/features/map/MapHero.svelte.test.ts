import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MapHero mobile chrome', () => {
	const source = () =>
		readFileSync(resolve(process.cwd(), 'src/lib/features/map/MapHero.svelte'), 'utf-8');
	const optionalSource = (path: string) => {
		try {
			return readFileSync(resolve(process.cwd(), path), 'utf-8');
		} catch {
			return '';
		}
	};

	it('hides the floating filter pill when the mobile detail sheet is open', () => {
		expect(source()).toMatch(/<MapFilterPill[\s\S]*hidden=\{detailOpen\}/);
	});

	it('keeps detail selection separate from hard URL filters', () => {
		const s = source();
		const selectFromDetail = s.match(/function selectFromDetail[\s\S]*?\n\t}/)?.[0] ?? '';

		expect(selectFromDetail).not.toContain('filters.addVehicle');
		expect(selectFromDetail).not.toContain('filters.addStop');
		expect(selectFromDetail).not.toContain('filters.addRoute');
	});

	it('adds direct map picks to the URL-backed filter spine', () => {
		const s = source();
		const selectPickedFeature = s.match(/function selectPickedFeature[\s\S]*?\n\t}/)?.[0] ?? '';
		const addSelectionFilter = s.match(/function addSelectionFilter[\s\S]*?\n\t}/)?.[0] ?? '';

		expect(selectPickedFeature).toContain('addSelectionFilter(next)');
		expect(addSelectionFilter).toContain("case 'vehicle'");
		expect(addSelectionFilter).toContain('filters.addVehicle(selection.id)');
		expect(addSelectionFilter).toContain("case 'stop'");
		expect(addSelectionFilter).toContain('filters.addStop(selection.id)');
		expect(addSelectionFilter).toContain("case 'route'");
		expect(addSelectionFilter).toContain('filters.addRoute(selection.id)');
	});

	it('puts the mobile freshness chip in the kicker row and anchors it right', () => {
		const s = source();

		expect(s).toContain('class="map-kicker-row"');
		expect(s).toContain('class="map-title-row"');
		expect(s).toContain("import MapFreshness from './MapFreshness.svelte'");
		expect(s).toContain('placement="head"');
		expect(s).toContain('placement="floating"');
		expect(s).not.toContain('class="map-head-fresh"');
		expect(s).not.toContain('class="map-overlay map-fresh"');
		expect(s).not.toContain("import { LiveFreshness } from '$lib/components/surface'");
		// The map shares the site-wide chip via the positioning wrapper, never the
		// old MapLiveFreshness/LiveFreshness primitives.
		expect(s).not.toContain('MapLiveFreshness');
	});

	it('wires near-me to browser location, the internal geocoder, and stop filters', () => {
		const s = source();

		expect(s).toContain("import MapNearMeControl from './MapNearMeControl.svelte'");
		expect(s).toContain('nearestStops');
		expect(s).toContain('navigator.geolocation.getCurrentPosition');
		expect(s).toContain('/api/geocode/montreal');
		expect(s).toContain('filters.addStop(stop.id)');
		expect(s).toContain("selected = { kind: 'stop', id: stop.id }");
	});

	it('delegates the near-me surface to the address suggestion component', () => {
		const s = source();

		expect(s).toContain('<MapNearMeControl');
		expect(s).toContain('bind:open={nearMeOpen}');
		expect(s).toContain('bind:query={nearMeQuery}');
		expect(s).toContain('onsuggestion={selectNearMeSuggestion}');
		expect(s).toContain('onstopselect={selectNearbyStop}');
		expect(s).toContain(
			'function selectNearMeSuggestion(\n\t\tresult: GeocodeSuggestion,\n\t\tsessionToken: string,\n\t): Promise<void>',
		);
		expect(s).toContain('hasCoordinates(result)');
		// Free-text picks (geo.ca/nominatim) still resolve by label…
		expect(s).toContain('await resolveNearMeQuery(result.label)');
		// …but a Google placeId pick resolves the EXACT place by id (Place Details),
		// reusing the autocomplete session token — the wrong-place fix.
		expect(s).toContain("result.placeId && result.source === 'google_places'");
		expect(s).toContain('await resolveNearMePlace(result.placeId, sessionToken)');
		expect(s).toContain('?placeId=${encodeURIComponent(placeId)}&session=');
	});

	it('zooms the camera to a route/stop/vehicle picked from search (one-shot focus)', () => {
		const s = source();

		expect(s).toContain("from '$lib/search/mapFocus'");
		expect(s).toContain('let pendingFocus = $state<MapFocus | null>(null)');
		expect(s).toContain('readFocusFromUrl($page.url.searchParams)');
		// resolves the kind's data then pans/fits and strips the param exactly once
		expect(s).toContain('function focusStop(id: string)');
		expect(s).toContain('function focusVehicle(id: string)');
		expect(s).toContain('function focusRoute(id: string)');
		expect(s).toContain('clearFocusFromUrl()');
	});

	it('zooms to a marker clicked directly on the map', () => {
		const s = source();
		const selectPickedFeature = s.match(/function selectPickedFeature[\s\S]*?\n\t}/)?.[0] ?? '';

		expect(selectPickedFeature).toContain('focusSelection(next)');
		expect(s).toContain('function focusSelection(selection: MapSelection)');
	});

	it('uncollapses the detail panel when a map marker is selected', () => {
		const s = source();
		// A direct map pick must always reveal its detail: if the panel was collapsed
		// in the icon strip, expand it (detailCollapsed = false) alongside detailOpen.
		const selectPickedFeature = s.match(/function selectPickedFeature[\s\S]*?\n\t}/)?.[0] ?? '';
		expect(selectPickedFeature).toContain('detailOpen = true');
		expect(selectPickedFeature).toContain('detailCollapsed = false');

		// The near-me stop pick is a marker selection too, so it expands as well.
		const selectNearbyStop = s.match(/function selectNearbyStop[\s\S]*?\n\t}/)?.[0] ?? '';
		expect(selectNearbyStop).toContain('detailOpen = true');
		expect(selectNearbyStop).toContain('detailCollapsed = false');
	});

	it('maps geolocation failure codes to distinct, secure-context-aware copy', () => {
		const s = source();

		expect(s).toContain('window.isSecureContext');
		expect(s).toContain('t.nearMeGeoInsecure');
		expect(s).toContain('geoError.code === geoError.PERMISSION_DENIED');
		expect(s).toContain('t.nearMeGeoDenied');
		expect(s).toContain('geoError.code === geoError.TIMEOUT');
		expect(s).toContain('t.nearMeGeoTimeout');
		expect(s).toContain('t.nearMeGeoUnavailable');
	});

	it('draws a distinct near-me location pin on the map when an address or browser location is selected', () => {
		const s = source();
		const mapIndex = optionalSource('src/lib/components/map/index.ts');

		expect(mapIndex).toContain('addNearTargetSource');
		expect(mapIndex).toContain('addNearTargetLayer');
		expect(mapIndex).toContain('setNearTarget');
		expect(mapIndex).toContain('bakeLocationPinSprite');
		expect(s).toContain('bakeLocationPinSprite(m)');
		expect(s).toContain('addNearTargetSource(m)');
		expect(s).toContain('addNearTargetLayer(m)');
		expect(s).toContain('setNearTarget(m, nearMeOrigin)');
	});

	it('zooms exact near-me addresses to block scale and vague places wider', () => {
		// The zoom-by-precision logic was extracted to the co-located pure module
		// mapGeo.ts (unit-tested directly in mapGeo.test.ts); MapHero now imports it
		// and calls it at the near-me fly-to. Assert the body in the module, the wiring
		// in MapHero.
		const geo = optionalSource('src/lib/features/map/mapGeo.ts');
		expect(geo).toContain('function zoomForNearMePrecision');
		expect(geo).toContain("case 'address'");
		expect(geo).toContain('return 17');
		expect(geo).toContain("case 'street'");
		expect(geo).toContain('return 15');
		expect(geo).toContain("case 'postal'");
		expect(geo).toContain('return 14');
		expect(geo).toContain("case 'neighbourhood'");
		expect(geo).toContain('return 13');

		const s = source();
		expect(s).toContain('zoomForNearMePrecision } from');
		expect(s).toContain('zoomForNearMePrecision(origin.precision)');
	});

	it('hydrates address search picks from the map near URL target', () => {
		const s = source();

		expect(s).toContain("import { nearTargetFromSearchParams } from '$lib/search/mapNear'");
		expect(s).toContain('syncNearTargetFromUrl($page.url.searchParams)');
		expect(s).toContain('nearTargetFromSearchParams(searchParams)');
		expect(s).toContain('setNearMeOrigin(nearTarget, false)');
	});

	it('hydrates the initial map near URL target before any navigation happens', () => {
		const s = source();

		expect(s).toContain('$effect(() => {\n\t\tsyncNearTargetFromUrl($page.url.searchParams);');
	});

	it('clears the address pin without clearing URL-backed map filters', () => {
		const s = source();
		// The URLSearchParams assembly was extracted to the pure mapUrlSync module
		// (clearNearTargetSearch, unit-tested in mapUrlSync.test.ts); MapHero keeps the
		// goto() shell that calls it + drops the local near-me state.
		const urlSync = optionalSource('src/lib/features/map/mapUrlSync.ts');
		expect(urlSync).toContain('clearNearTargetSearch');
		expect(urlSync).toContain('clearNearTargetSearchParams(nextSearchParams)');
		expect(s).toContain('function clearNearMeOrigin()');
		expect(s).toContain('clearNearTargetSearch($page.url.searchParams, $page.url.pathname)');
		expect(s).toContain('nearMeOrigin = null');
		expect(s).toContain('nearMeQuery =');
		expect(s).toContain('onclear={clearNearMeOrigin}');
	});

	it('writes chosen near-me locations into the URL without clearing map filters', () => {
		const s = source();
		// The URLSearchParams assembly was extracted to the pure mapUrlSync module
		// (buildNearTargetSearch, unit-tested in mapUrlSync.test.ts); MapHero keeps the
		// goto() shell that calls it.
		const urlSync = optionalSource('src/lib/features/map/mapUrlSync.ts');
		expect(urlSync).toContain('setNearTargetSearchParams');
		expect(urlSync).toContain('setNearTargetSearchParams(nextSearchParams, target)');
		expect(s).toContain('function syncNearTargetToUrl(origin: NearMeOrigin)');
		expect(s).toContain(
			'buildNearTargetSearch($page.url.searchParams, $page.url.pathname, origin)',
		);
		expect(s).toContain('syncNearTargetToUrl(origin)');
	});

	it('places the near-me control at the bottom right on desktop', () => {
		const s = optionalSource('src/lib/features/map/MapNearMeControl.svelte');

		expect(s).toMatch(/\.map-near\s*\{[\s\S]*top:\s*auto/);
		expect(s).toMatch(
			/\.map-near\s*\{[\s\S]*right:\s*calc\(var\(--map-detail-offset, 0rem\) \+ 1rem\)/,
		);
		expect(s).toMatch(/\.map-near\s*\{[\s\S]*bottom:\s*5\.1rem/);
		expect(s).toMatch(/\.map-near\s*\{[\s\S]*width:\s*auto/);
	});

	it('keeps the desktop filter overlay as positioning only so the card owns scrolling', () => {
		const s = source();
		const filterPanelBlock = s.match(/\.map-filter-panel\s*\{[\s\S]*?\}/)?.[0] ?? '';

		expect(filterPanelBlock).toContain('top: 5.25rem');
		expect(filterPanelBlock).toContain('left: calc(var(--app-left-rail-offset, 0rem) + 1rem)');
		expect(filterPanelBlock).not.toContain('overflow-y');
		expect(filterPanelBlock).not.toContain('max-height');
	});

	it('offsets left-side map chrome from the overlay rail without moving the map canvas', () => {
		const s = source();

		expect(s).toMatch(
			/\.map-head\s*\{[\s\S]*left:\s*calc\(var\(--app-left-rail-offset, 0rem\) \+ 1rem\)/,
		);
		expect(s).toMatch(
			/\.map-head\s*\{[\s\S]*max-width:\s*calc\(\s*100%\s*-\s*var\(--app-left-rail-offset,\s*0rem\)\s*-\s*var\(--map-detail-offset,\s*0rem\)\s*-\s*2rem\s*\)/,
		);
		expect(s).toMatch(
			/\.map-filter-panel\s*\{[\s\S]*left:\s*calc\(var\(--app-left-rail-offset, 0rem\) \+ 1rem\)/,
		);
		// Unified map breakpoint: the compact phone-style head + the panel-hide ride
		// the SAME 1024px line as the pill-hide and the JS layout.isDesktop snapshot
		// (no dead 760px band where the panel and pill could both show).
		expect(s).toMatch(/@media \(max-width: 1023px\)[\s\S]*\.map-head\s*\{[\s\S]*left:\s*0\.75rem/);
	});

	it('scopes desktop floating chrome to the map pane (overlays live inside the map pane)', () => {
		const s = source();
		const nearMe = optionalSource('src/lib/features/map/MapNearMeControl.svelte');

		// The chrome (near-me, freshness, peek) lives INSIDE the map pane now (the
		// mapSurface snippet), so it is scoped to the map pane's width with no
		// --map-detail-offset bookkeeping: the offset is a permanent 0 (resolving the
		// shared overlay CSS to "1rem from the map pane's own right edge"). There is no
		// per-frame ResizeObserver in MapHero — the map.resize() on a pane drag is the
		// only resize call, and it carries no fit/zoom.
		expect(s).not.toContain('style={`--map-detail-offset: ${mapDetailOffset}`}');
		expect(s).not.toContain('mapDetailOffset');
		expect(s).toContain('--map-detail-offset: 0rem;');
		expect(s).not.toContain('new ResizeObserver');
		expect(s).toContain('placement="floating"');
		// The map surface snippet wraps mapBody + every overlay, rendered once inside
		// the map ResizablePane.
		expect(s).toContain('{#snippet mapSurface()}');
		expect(s).toContain('{@render mapSurface()}');
		expect(nearMe).toMatch(
			/\.map-near\s*\{[\s\S]*right:\s*calc\(var\(--map-detail-offset, 0rem\) \+ 1rem\)/,
		);
	});

	it('keeps desktop hover peek available while the right detail rail is open', () => {
		const s = source();
		const hoverBlock = s.match(/\{#if hoverDetail[\s\S]*?<\/div>\s*\{\/if\}/)?.[0] ?? '';

		expect(hoverBlock).toContain('hoverDetail');
		expect(hoverBlock).toContain('layout.isDesktop');
		expect(hoverBlock).not.toContain('!detailOpen');
		expect(s).toMatch(
			/\.map-peek\s*\{[\s\S]*right:\s*calc\(var\(--map-detail-offset, 0rem\) \+ 1rem\)/,
		);
		expect(s).toMatch(/\.map-peek\s*\{[\s\S]*z-index:\s*24/);
	});

	it('feeds hovered markers into the same highlight path as clicked markers', () => {
		const s = source();
		const hoverPickedFeature = s.match(/function hoverPickedFeature[\s\S]*?\n\t}/)?.[0] ?? '';
		const toVehicleFeaturesBlock = s.match(/toVehicleFeatures\([\s\S]*?\),\s*\{/)?.[0] ?? '';
		const setStopsBlock = s.match(/setStops\([\s\S]*?\);/)?.[0] ?? '';

		expect(s).toContain(
			"const hoveredVehicleId = $derived(hovered?.kind === 'vehicle' ? hovered.id : null)",
		);
		expect(s).toContain(
			"const hoveredStopId = $derived(hovered?.kind === 'stop' ? hovered.id : null)",
		);
		expect(hoverPickedFeature).toContain('sameNullableSelection(hovered, next)');
		expect(toVehicleFeaturesBlock).toContain('selectedVehicleId');
		expect(toVehicleFeaturesBlock).toContain('hoveredVehicleId');
		expect(setStopsBlock).toContain('selectedStopId');
		expect(setStopsBlock).toContain('hoveredStopId');
	});

	it('animates vehicle movement between live ticks through the shared motion controller', () => {
		const s = source();

		expect(s).toContain('createVehicleMotionController');
		expect(s).toContain('let vehicleMotion = $state<VehicleMotionController | null>(null)');
		expect(s).toContain('vehicleMotion?.set(');
		expect(s).toContain('tickKey: live.vehicles?.generated_utc ?? live.generatedUtc');
		expect(s).toContain('stale: live.isStale');
		expect(s).not.toContain('setVehicles(');
	});

	it('uses a mobile locate button at the bottom right without covering attribution', () => {
		const s = optionalSource('src/lib/features/map/MapNearMeControl.svelte');

		expect(s).toContain("import LocateFixedIcon from '@lucide/svelte/icons/locate-fixed'");
		expect(s).toContain('class="map-near-icon"');
		expect(s).toMatch(/@media \(max-width: 760px\)[\s\S]*\.map-near\s*\{[\s\S]*top:\s*auto/);
		expect(s).toMatch(/@media \(max-width: 760px\)[\s\S]*\.map-near\s*\{[\s\S]*right:\s*0\.75rem/);
		expect(s).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.map-near\s*\{[\s\S]*bottom:\s*calc\(3\.35rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
		);
		expect(s).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.map-near-toggle span\s*\{[\s\S]*display:\s*none/,
		);
	});

	it('does not fake a square basemap by forcing the mobile viewport into a square frame', () => {
		const s = source();
		const mobileBlock = s.match(/@media \(max-width: 760px\)\s*\{[\s\S]*?\n\t}/)?.[0] ?? '';

		expect(mobileBlock).not.toContain('aspect-ratio: 1 / 1');
		expect(mobileBlock).not.toContain('height: min(100dvh, 100vw)');
		expect(mobileBlock).not.toContain('max-height: 100vw');
	});

	it('re-seeds URL filters after normal client navigation, not only browser popstate', () => {
		const s = source();
		const navigationBlock = s.match(/afterNavigate\(\(\) => \{[\s\S]*?\}\);/)?.[0] ?? '';

		expect(navigationBlock).toContain('filters.replace(fromSearchParams($page.url.searchParams))');
		expect(navigationBlock).not.toContain("nav.type === 'popstate'");
	});

	it('draws route linework from the filter-selected routes plus a selected vehicle route', () => {
		const s = source();
		const setRouteLinesBlock = s.match(/setRouteLines\([\s\S]*?\);/)?.[0] ?? '';
		const routeLineRoutesBlock =
			s.match(/const routeLineRoutes = \$derived\.by[\s\S]*?\n\t\}\);/)?.[0] ?? '';

		// routeLineRoutes is the DRAW list: filter-selected routes (routeList) plus
		// the selected vehicle's route geometry so its highlight has a line. With no
		// route filter AND no selected vehicle route, it collapses to routeList (empty).
		expect(routeLineRoutesBlock).toContain('[...routeList]');
		expect(routeLineRoutesBlock).toContain('selectedVehicleRoute');
		expect(setRouteLinesBlock).toContain('routeLineRoutes');
		expect(setRouteLinesBlock).toContain('selectedRouteLine');
		// The hover-context route bundle is NOT the draw list (that would draw lines on
		// hover); only routeList + the selected vehicle route render.
		expect(setRouteLinesBlock).not.toContain('contextRoutes');
	});

	it('highlights the route line of a selected vehicle (click-a-bus-shows-its-route)', () => {
		const s = source();
		const selectedRouteLineBlock =
			s.match(/const selectedRouteLine = \$derived\([\s\S]*?\);/)?.[0] ?? '';
		const selectedRouteLineIdBlock =
			s.match(/const selectedRouteLineId = \$derived\.by[\s\S]*?\n\t\}\);/)?.[0] ?? '';

		// The highlighted line id resolves from a directly-selected route OR a selected
		// vehicle's route (via the live byVehicleId lookup — the same one focusedRouteId
		// uses). A bus with no route id yields null → no highlight (honest).
		expect(selectedRouteLineIdBlock).toContain("selected?.kind === 'route'");
		expect(selectedRouteLineIdBlock).toContain("selected?.kind === 'vehicle'");
		expect(selectedRouteLineIdBlock).toContain('live.index.byVehicleId.get(selected.id)?.route');
		// selectedRouteLine carries that id for the vehicle case (whole route lights up,
		// no direction on a vehicle), and stays null when there is no route id.
		expect(selectedRouteLineBlock).toContain("selected?.kind === 'vehicle' && selectedRouteLineId");
		expect(selectedRouteLineBlock).toContain('id: selectedRouteLineId');
	});

	it('surfaces a non-blocking live-feed edge notice without wrapping the GL canvas', () => {
		const s = source();

		// Derives a tri-state from the LIVE STORE (error + generatedUtc + vehicles),
		// NOT a ResourceBoundary wrap (the live store is not a Resource, and a wrap
		// would blank the canvas — the wrong loading model for this surface).
		expect(s).toContain('liveEdgeState');
		expect(s).toContain("'unavailable'");
		expect(s).toContain("'no-vehicles'");
		// 'unavailable' is cold-start-down: an error AND no build ever loaded (a prior
		// build leaves the freshness pill's stale verdict to carry the signal).
		expect(s).toContain('live.error != null && live.generatedUtc == null');
		// 'no-vehicles' is a fresh, successful build that reports zero vehicles.
		expect(s).toContain('live.vehicles != null && !live.isStale');
		// The notice is a floating overlay (not a boundary): a polite live region.
		expect(s).toContain('class="map-overlay map-live-edge"');
		expect(s).toContain('role="status"');
		expect(s).toContain('aria-live="polite"');
		expect(s).toContain('{liveEdgeMessage}');
		// Localized copy, not inline literals.
		expect(s).toContain('t.liveUnavailable');
		expect(s).toContain('t.liveNoVehicles');
		// The notice never intercepts pointer input (the map stays fully usable).
		expect(s).toMatch(/\.map-live-edge\s*\{[\s\S]*pointer-events:\s*none/);
		// It is NOT a ResourceBoundary around the map.
		expect(s).not.toContain('<ResourceBoundary');
	});

	it('mounts the map stage without waiting for the optional basemap pointer', () => {
		const s = source();
		const mapStageBlock = s.match(/<MapStage[\s\S]*?\/>/)?.[0] ?? '';

		// The camera FITS the island bounds (not the wide square) so the off-island
		// south-shore east is cropped, framed into a square central gap with static
		// width-fraction left/right buffers (no re-fit on panel toggle); maxBounds
		// stays the looser basemap square.
		expect(s).toContain('const MAP_FIT_PADDING_PX = 40');
		expect(s).toContain('const ISLAND_FIT_BOUNDS');
		expect(s).toContain('DESKTOP_LEFT_PAD_FRAC');
		expect(s).toContain('DESKTOP_RIGHT_PAD_FRAC');
		expect(s).toContain('const mapFitPadding = $derived');
		expect(s).not.toContain('{#if basemap.settled}');
		// B2 — the basemap resolves via `basemapLoader` (awaited inside MapStage's
		// onMount, baked into the constructor style) for a HOT first paint with no
		// post-mount setStyle wipe. It is no longer a post-mount createResource whose
		// null→file settle triggered a full style rebuild (the flicker).
		expect(mapStageBlock).toContain('basemapLoader={() => getBasemap()}');
		expect(mapStageBlock).not.toContain('basemap={basemap.data}');
		expect(s).not.toContain('const basemap = createResource');
		expect(mapStageBlock).toContain('{theme}');
		expect(mapStageBlock).toContain('bounds={ISLAND_FIT_BOUNDS}');
		// maxBounds crops the off-island east (south-shore) — fit padding can't crop.
		expect(mapStageBlock).toContain('maxBounds={MAP_MAX_BOUNDS}');
		expect(s).toContain('const MAP_MAX_BOUNDS');
		expect(mapStageBlock).toContain('fitPadding={mapFitPadding}');
	});

	it('resolves the camera-affecting layout ONCE post-mount, not off the hydration-flipping store', () => {
		const s = source();
		const fitPaddingBlock = s.match(/const mapFitPadding = \$derived[\s\S]*?\);/)?.[0] ?? '';

		// The fit padding (which re-runs MapLibre fitBounds on change) reads a one-shot
		// `isDesktopLayout` snapshot, NOT `layout.isDesktop` — the shared store reads
		// `false` on the server and flips true during hydration, which would re-fit and
		// shift the camera on the first paint.
		expect(s).toContain('import { layout, isDesktopViewport } from');
		expect(s).toContain('let isDesktopLayout = $state(isDesktopViewport())');
		expect(fitPaddingBlock).toContain('isDesktopLayout && fitWidthPx > 0');
		expect(fitPaddingBlock).not.toContain('layout.isDesktop');
		// The snapshot is confirmed post-mount via matchMedia and only updated on a
		// genuine viewport crossing (a `change` event), never on the hydration pass.
		expect(s).toContain("window.matchMedia('(min-width: 1024px)')");
		expect(s).toContain('isDesktopLayout = mql.matches');
		expect(s).toContain("mql.addEventListener('change', onChange)");
	});

	it('keeps right-pane drilldown history separate from direct map picks', () => {
		const s = source();
		const selectPickedFeature = s.match(/function selectPickedFeature[\s\S]*?\n\t}/)?.[0] ?? '';
		const selectFromDetail = s.match(/function selectFromDetail[\s\S]*?\n\t}/)?.[0] ?? '';
		const closeDetail = s.match(/function closeDetail[\s\S]*?\n\t}/)?.[0] ?? '';

		expect(s).toContain('let selectionStack = $state<MapSelection[]>([])');
		expect(selectPickedFeature).toContain('selectionStack = []');
		expect(selectFromDetail).toContain('selectionStack = [...selectionStack, selected]');
		expect(s).toContain('function goBackDetail()');
		expect(s).toContain('canGoBack={selectionStack.length > 0}');
		expect(s).toContain('onback={goBackDetail}');
		expect(closeDetail).toContain('selectionStack = []');
	});

	it('wires the mobile detail sheet to the same drilldown back stack', () => {
		const s = source();
		const mobileSheetBlock =
			s.match(/\{#if detailOpen && !layout\.isDesktop\}[\s\S]*?<\/BottomSheet>/)?.[0] ?? '';

		expect(mobileSheetBlock).toContain('canGoBack={selectionStack.length > 0}');
		expect(mobileSheetBlock).toContain('onback={goBackDetail}');
	});

	it('keeps the detail surfaces mounted while a back target is resolving', () => {
		const s = source();
		const mobileSheetBlock =
			s.match(/\{#if detailOpen && !layout\.isDesktop\}[\s\S]*?<\/BottomSheet>/)?.[0] ?? '';

		expect(s).not.toContain('{#if detailOpen && selectedDetail}');
		// The desktop floating detail overlay mounts on `detailOpen` (not on resolved
		// data), so the surface stays mounted while a back target resolves. It gates on
		// `layout.isDesktop && detailOpen`.
		expect(s).toContain('{#if layout.isDesktop && detailOpen}');
		expect(mobileSheetBlock).toContain('title={selectedDetail?.title}');
		expect(mobileSheetBlock).toContain('{#if selectedDetail}');
		expect(mobileSheetBlock).toContain('detail={selectedDetail}');
	});

	it('renders the map full-bleed with the detail as an absolute right OVERLAY (no paneforge)', () => {
		const s = source();

		// THE LAW: the map canvas is full-bleed and FIXED. There is NO paneforge pane
		// group redistributing width between a map pane and a detail pane (that pane
		// swap resized the map — the exact regression). The map is rendered directly
		// inside .map-hero; every panel OVERLAYS it.
		expect(s).not.toContain('ResizablePaneGroup');
		expect(s).not.toContain('ResizablePane');
		expect(s).not.toContain('ResizableHandle');
		expect(s).not.toContain("from '$lib/components/ui/resizable'");
		expect(s).not.toContain('onMapPaneResize');
		expect(s).not.toContain('onPaneLayoutChange');
		expect(s).not.toContain('paneSizes');
		expect(s).not.toContain('map-stage-pane');
		expect(s).not.toContain('map-detail-pane');

		// The map surface is rendered directly in the hero (full-bleed, inset:0).
		expect(s).toContain('{@render mapSurface()}');
		expect(s).toMatch(/\.map-surface\s*\{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/);
		expect(s).toMatch(
			/\.map-surface\s*:global\(\.map-hero-stage\)\s*\{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/,
		);

		// The detail rides an absolute OVERLAY anchored flush to the map's right edge,
		// rendered only on `layout.isDesktop && detailOpen` (so the surface stays mounted
		// while a back target resolves), with its width the live --app-right-detail-offset
		// CSS var and its box-shadow on the overlay (vanishes WITH it when closed).
		expect(s).toMatch(
			/\{#if layout\.isDesktop && detailOpen\}[\s\S]*class="map-detail-overlay"[\s\S]*\{@render detailPanel\(\)\}[\s\S]*\{\/if\}/,
		);
		expect(s).toMatch(
			/\.map-detail-overlay\s*\{[\s\S]*position:\s*absolute[\s\S]*right:\s*0[\s\S]*width:\s*var\(--app-right-detail-offset\)/,
		);
		expect(s).toMatch(/\.map-detail-overlay\s*\{[\s\S]*box-shadow:\s*var\(--shadow-section\)/);

		// The detail panel snippet is a RightPanel wired for the overlay: close, back,
		// AND collapse (collapsing slides the overlay off the right edge) + resizable so
		// it fills the overlay's dragged width.
		const detailPanelBlock =
			s.match(/\{#snippet detailPanel\(\)\}[\s\S]*?\{\/snippet\}/)?.[0] ?? '';
		expect(detailPanelBlock).toContain('<RightPanel');
		expect(detailPanelBlock).toContain('onclose={closeDetail}');
		expect(detailPanelBlock).toContain('onback={goBackDetail}');
		expect(detailPanelBlock).toContain('collapsed={detailCollapsed}');
		expect(detailPanelBlock).toContain('ontogglecollapse={toggleDetailCollapsed}');
		expect(detailPanelBlock).toContain('resizable');
		expect(detailPanelBlock).not.toContain('style={`width:');
	});

	it('keeps mobile detail on the bottom sheet (the right overlay is desktop-only) while the map stays mounted on every breakpoint', () => {
		const s = source();
		const mobileSheetBlock =
			s.match(/\{#if detailOpen && !layout\.isDesktop\}[\s\S]*?<\/BottomSheet>/)?.[0] ?? '';

		expect(mobileSheetBlock).toContain('<BottomSheet');
		expect(mobileSheetBlock).toContain('bind:open={detailOpen}');
		// The map surface is ALWAYS rendered full-bleed (one MapStage, one GL context).
		// The right detail OVERLAY only renders on `layout.isDesktop && detailOpen`, so no
		// overlay appears on mobile; the detail rides the BottomSheet instead.
		expect(s).toContain('{@render mapSurface()}');
		expect(s).toContain('{#if layout.isDesktop && detailOpen}');
		// The mobile sheet is a SIBLING of the desktop overlay, both inside the hero.
		expect(s).toMatch(/class="map-detail-overlay"[\s\S]*\{#if detailOpen && !layout\.isDesktop\}/);
	});

	// No paneforge, no per-element rail measurement machinery, no ResizeObserver in
	// MapHero. The right detail overlay's width is a single CSS-var px scalar (like the
	// left nav rail), dragged by a manual pointer handler and persisted to localStorage.
	it('sizes the detail overlay via a CSS-var px scalar, with no paneforge and no ResizeObserver', () => {
		const s = source();

		// No paneforge, no hand-rolled measured panes / ResizeObserver.
		expect(s).not.toContain("from '$lib/components/ui/resizable'");
		expect(s).not.toContain("from './mapRailSizing'");
		expect(s).not.toContain('railSizing');
		expect(s).not.toContain('mapStagePaneEl');
		expect(s).not.toContain('mapStageWidthPx');
		expect(s).not.toContain('new ResizeObserver');
		expect(s).not.toContain('collapsedSize=');
		expect(s).not.toContain('defaultSize=');

		// The overlay width is a persisted px scalar dragged into the CSS var, mirroring
		// the left nav rail (leftRailWidth.ts). Collapse is a pure local data-attr flip.
		expect(s).toContain("from './mapDetailPanes'");
		expect(s).toContain('let detailWidthPx = $state(readStoredDetailPanelWidth())');
		expect(s).toContain('let detailCollapsed = $state(false)');
		expect(s).toContain("setProperty('--app-right-detail-offset'");
		expect(s).toContain('writeStoredDetailPanelWidth(detailWidthPx)');
		expect(s).toContain('function toggleDetailCollapsed()');

		// The fit padding runs off the (window-reactive) HERO width. Because every panel
		// overlays the map (absolute), the hero width only changes on a real viewport
		// resize, so a panel drag never re-derives the padding (no fitBounds re-run).
		expect(s).toContain('const fitWidthPx = $derived(mapWidthPx)');
	});

	// B3 — clicking a bus promotes its route to the filter spine (route= param + a
	// removable chip), and the route-line highlight is gated on that filter so the
	// chip and highlight stay in lockstep (discard the chip → un-highlight).
	it('promotes a clicked bus route to the URL filter spine as a removable chip (B3)', () => {
		const s = source();
		const addSelectionFilter = s.match(/function addSelectionFilter[\s\S]*?\n\t}/)?.[0] ?? '';
		const promote = s.match(/function promoteVehicleRoute[\s\S]*?\n\t}/)?.[0] ?? '';

		// The vehicle branch adds the vehicle AND promotes its route.
		expect(addSelectionFilter).toContain('filters.addVehicle(selection.id)');
		expect(addSelectionFilter).toContain('promoteVehicleRoute(selection.id)');
		// The route is resolved via the SAME live index the highlight uses, then added
		// to the route filter (which renders the existing removable route chip + the
		// route= URL param). A bus with no route id is a no-op.
		expect(promote).toContain('live.index.byVehicleId.get(vehicleId)?.route');
		expect(promote).toContain('filters.addRoute(route)');
	});

	it('gates the selected-vehicle route-line highlight on the route filter so discarding the chip un-highlights (B3)', () => {
		const s = source();
		const selectedRouteLineIdBlock =
			s.match(/const selectedRouteLineId = \$derived\.by[\s\S]*?\n\t\}\);/)?.[0] ?? '';

		// The vehicle case only highlights while the route is still in filters.routes;
		// removing the chip (filters.removeRoute) drops it from the set → no highlight.
		expect(selectedRouteLineIdBlock).toContain("selected?.kind === 'vehicle'");
		expect(selectedRouteLineIdBlock).toContain('filters.routes.has(route)');
	});

	// THE LAW #1: dragging or collapsing the right detail panel resizes ONLY that
	// overlay (its CSS-var width / a data-attr), NEVER the map. The map's only size
	// driver is MapStage's own container ResizeObserver on a genuine viewport change.
	// So NONE of the panel handlers may call map.resize()/fitBounds/easeTo/etc.
	it('resizes the detail overlay without ever touching the map camera (no jump)', () => {
		const s = source();

		// CRITICAL: the pointer-drag + keyboard + collapse handlers write the width var
		// and persist it, and do NOTHING to the map. A map.resize()/fitBounds/easeTo/
		// flyTo/setZoom/setCenter in any of them would reflow the camera — the exact
		// regression the operator hit.
		const dragDown = s.match(/function onDetailHandlePointerDown[\s\S]*?\n\t\}/)?.[0] ?? '';
		const dragMove = s.match(/function onDetailHandlePointerMove[\s\S]*?\n\t\}/)?.[0] ?? '';
		const dragUp = s.match(/function onDetailHandlePointerUp[\s\S]*?\n\t\}/)?.[0] ?? '';
		const keyDown = s.match(/function onDetailHandleKeyDown[\s\S]*?\n\t\}/)?.[0] ?? '';
		const toggle = s.match(/function toggleDetailCollapsed[\s\S]*?\n\t\}/)?.[0] ?? '';
		for (const handler of [dragDown, dragMove, dragUp, keyDown, toggle]) {
			expect(handler).not.toMatch(/map\??\.resize|fitBounds|setCenter|setZoom|easeTo|flyTo|jumpTo/);
		}
		// The drag clamps the width and persists it; collapse is a pure local flip.
		expect(dragMove).toContain('clampDetailPanelWidth');
		expect(dragUp).toContain('writeStoredDetailPanelWidth(detailWidthPx)');
		expect(toggle).toContain('detailCollapsed = !detailCollapsed');

		// There is NO paneforge pane-resize hook left to fire map.resize() (that path is
		// gone with the pane group). The handlers above are the only resize callers.
		expect(s).not.toContain('onMapPaneResize');
		expect(s).not.toContain('onPaneLayoutChange');

		// The detail OVERLAY carries its OWN box-shadow so the lift vanishes WITH it when
		// the detail closes (the overlay only exists inside `layout.isDesktop &&
		// detailOpen`), so the closed state has no overlay and therefore no leftover lift.
		expect(s).toMatch(/\.map-detail-overlay\s*\{[\s\S]*box-shadow:\s*var\(--shadow-section\)/);
	});
});
