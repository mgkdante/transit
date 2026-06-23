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

		expect(s).toContain('clearNearTargetSearchParams');
		expect(s).toContain('function clearNearMeOrigin()');
		expect(s).toContain('clearNearTargetSearchParams(nextSearchParams)');
		expect(s).toContain('nearMeOrigin = null');
		expect(s).toContain('nearMeQuery =');
		expect(s).toContain('onclear={clearNearMeOrigin}');
	});

	it('writes chosen near-me locations into the URL without clearing map filters', () => {
		const s = source();

		expect(s).toContain('setNearTargetSearchParams');
		expect(s).toContain('function syncNearTargetToUrl(origin: NearMeOrigin)');
		expect(s).toContain('setNearTargetSearchParams(nextSearchParams, origin)');
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
		expect(s).toMatch(/@media \(max-width: 760px\)[\s\S]*\.map-head\s*\{[\s\S]*left:\s*0\.75rem/);
	});

	it('offsets desktop floating chrome by the fixed floating-panel width when the detail is open', () => {
		const s = source();
		const nearMe = optionalSource('src/lib/features/map/MapNearMeControl.svelte');

		expect(s).toContain('style={`--map-detail-offset: ${mapDetailOffset}`}');
		// The offset is the FIXED floating-panel width while open (no ResizeObserver,
		// no per-frame measurement of a resizable pane), and 0rem while closed.
		expect(s).toContain('const MAP_DETAIL_PANEL_WIDTH_PX = 360');
		expect(s).toContain(
			"detailOpen && layout.isDesktop ? `${MAP_DETAIL_PANEL_WIDTH_PX}px` : '0rem'",
		);
		expect(s).not.toContain('new ResizeObserver');
		expect(s).toContain('placement="floating"');
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

	it('renders the map FULL-BLEED with the detail FLOATING over its right slice (desktop)', () => {
		const s = source();
		const detailOverlayBlock =
			s.match(
				/\{#if layout\.isDesktop && detailOpen\}[\s\S]*?class="map-overlay map-detail-overlay"[\s\S]*?\{\/if\}/,
			)?.[0] ?? '';

		// STAGE 2 — the map is no longer a resizable pane. The resizable primitives and
		// their CSS are gone so opening a selection never shrinks the canvas (no
		// MapLibre resize, no jump/zoom-break). The mapRailSizing helper is dead too.
		expect(s).not.toContain('ResizablePaneGroup');
		expect(s).not.toContain('ResizablePane');
		expect(s).not.toContain('ResizableHandle');
		expect(s).not.toContain('$lib/components/ui/resizable');
		expect(s).not.toContain('mapRailSizing');
		expect(s).not.toContain('railSizing');
		expect(s).not.toContain('map-detail-resize-handle');
		expect(s).not.toContain('map-detail-pane');
		expect(s).not.toContain('map-stage-pane');
		expect(s).not.toContain('map-pane-group');
		expect(s).not.toContain('map-detail-dock');

		// The map body is rendered DIRECTLY in the hero (full-bleed base layer), always
		// mounted (one stable GL context across the 1024px breakpoint), not gated on
		// isDesktop.
		expect(s).toMatch(/<!--[\s\S]*FULL-BLEED[\s\S]*-->\s*\{@render mapBody\(\)\}/);
		expect(s).toMatch(
			/:global\(\.map-hero-stage\)\s*\{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/,
		);

		// The detail rides a fixed-width FLOATING overlay (mirroring the left
		// .map-overlay controls) that only mounts when a selection is open on desktop;
		// it carries the close + back control and is a labelled dialog region.
		expect(detailOverlayBlock).toContain('class="map-overlay map-detail-overlay"');
		expect(detailOverlayBlock).toContain('role="dialog"');
		expect(detailOverlayBlock).toContain('aria-label=');
		expect(detailOverlayBlock).toContain('{@render detailPanel()}');

		// The detail panel snippet drops the resizable/collapse wiring (no paneforge);
		// it is a plain RightPanel with close + back.
		const detailPanelBlock =
			s.match(/\{#snippet detailPanel\(\)\}[\s\S]*?\{\/snippet\}/)?.[0] ?? '';
		expect(detailPanelBlock).toContain('<RightPanel');
		expect(detailPanelBlock).toContain('onclose={closeDetail}');
		expect(detailPanelBlock).toContain('onback={goBackDetail}');
		expect(detailPanelBlock).not.toContain('resizable');
		expect(detailPanelBlock).not.toContain('collapsed=');
		expect(detailPanelBlock).not.toContain('ontogglecollapse');

		// The floating overlay owns a comfortable fixed width and its own internal
		// scroll (RightPanel's body), so the map never resizes underneath it.
		expect(s).toMatch(/\.map-detail-overlay\s*\{[\s\S]*width:\s*360px/);
	});

	it('keeps mobile detail on the bottom sheet (no floating overlay) while the map stays full-bleed on every breakpoint', () => {
		const s = source();
		const mobileSheetBlock =
			s.match(/\{#if detailOpen && !layout\.isDesktop\}[\s\S]*?<\/BottomSheet>/)?.[0] ?? '';

		expect(mobileSheetBlock).toContain('<BottomSheet');
		expect(mobileSheetBlock).toContain('bind:open={detailOpen}');
		// The map renders FULL-BLEED on every breakpoint (one MapStage, one GL context),
		// always mounted. The floating desktop detail overlay only mounts on
		// `layout.isDesktop && detailOpen`, so no overlay appears on mobile; the detail
		// rides the BottomSheet instead.
		expect(s).toContain('{@render mapBody()}');
		expect(s).toContain('{#if layout.isDesktop && detailOpen}');
		expect(s).not.toContain('{:else}\n\t\t{@render mapBody()}');
	});

	// STAGE 2 — the resizable rail (and its B1 responsive-percent sizing machinery)
	// is GONE: the detail floats over the map at a fixed width, so there is no pane to
	// size, no ResizeObserver to measure it, and no collapse/expand wiring.
	it('drops the resizable-rail machinery now that the detail floats at a fixed width (Stage 2)', () => {
		const s = source();

		// The mapRailSizing helper, its derived percents, and the right-panel resizable
		// state are all removed.
		expect(s).not.toContain("from './mapRailSizing'");
		expect(s).not.toContain('railSizing');
		expect(s).not.toContain('rightPanelPane');
		expect(s).not.toContain('rightPanelEl');
		expect(s).not.toContain('rightPanelWidthPx');
		expect(s).not.toContain('rightPanelCollapsed');
		expect(s).not.toContain('toggleRightPanelCollapsed');
		expect(s).not.toContain('mapStagePaneEl');
		expect(s).not.toContain('mapStageWidthPx');
		// No paneforge sizing props or collapse callbacks survive.
		expect(s).not.toContain('defaultSize=');
		expect(s).not.toContain('collapsedSize=');
		expect(s).not.toContain('onCollapse');
		expect(s).not.toContain('onExpand');

		// The fit padding now runs straight off the (window-reactive) hero width since
		// the map never shrinks.
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
});
