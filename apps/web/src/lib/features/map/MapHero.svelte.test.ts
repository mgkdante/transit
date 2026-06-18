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
		expect(s).toContain("import MapLiveFreshness from './MapLiveFreshness.svelte'");
		expect(s).toContain('placement="head"');
		expect(s).toContain('placement="floating"');
		expect(s).not.toContain('class="map-head-fresh"');
		expect(s).not.toContain('class="map-overlay map-fresh"');
		expect(s).not.toContain("import { LiveFreshness } from '$lib/components/surface'");
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
			'function selectNearMeSuggestion(result: GeocodeSuggestion): Promise<void>',
		);
		expect(s).toContain('hasCoordinates(result)');
		expect(s).toContain('await resolveNearMeQuery(result.label)');
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
		const s = source();

		expect(s).toContain('function zoomForNearMePrecision');
		expect(s).toContain("case 'address'");
		expect(s).toContain('return 17');
		expect(s).toContain("case 'street'");
		expect(s).toContain('return 15');
		expect(s).toContain("case 'postal'");
		expect(s).toContain('return 14');
		expect(s).toContain("case 'neighbourhood'");
		expect(s).toContain('return 13');
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

	it('offsets desktop floating chrome when the right pane is open or collapsed', () => {
		const s = source();
		const nearMe = optionalSource('src/lib/features/map/MapNearMeControl.svelte');

		expect(s).toContain('style={`--map-detail-offset: ${mapDetailOffset}`}');
		expect(s).toContain('ResizeObserver');
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

	it('clears route linework when the URL has no route filter params', () => {
		const s = source();
		const setRouteLinesBlock = s.match(/setRouteLines\([\s\S]*?\);/)?.[0] ?? '';

		expect(s).toContain('const routeLineRoutes = $derived(routeList)');
		expect(setRouteLinesBlock).toContain('routeLineRoutes');
		expect(setRouteLinesBlock).not.toContain('contextRoutes');
	});

	it('mounts the map stage without waiting for the optional basemap pointer', () => {
		const s = source();
		const mapStageBlock = s.match(/<MapStage[\s\S]*?\/>/)?.[0] ?? '';

		expect(s).toContain('const DESKTOP_MAP_FIT_LEFT_PADDING_PX = 520');
		expect(s).toContain('const mapFitPadding = $derived');
		expect(s).not.toContain('{#if basemap.settled}');
		expect(mapStageBlock).toContain('basemap={basemap.data}');
		expect(mapStageBlock).toContain('{theme}');
		expect(mapStageBlock).toContain('bounds={manifest.bbox}');
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
		const mobileSheetBlock = s.match(/\{:else\}\s*<BottomSheet[\s\S]*?<\/BottomSheet>/)?.[0] ?? '';

		expect(mobileSheetBlock).toContain('canGoBack={selectionStack.length > 0}');
		expect(mobileSheetBlock).toContain('onback={goBackDetail}');
	});

	it('keeps the detail surfaces mounted while a back target is resolving', () => {
		const s = source();
		const mobileSheetBlock = s.match(/\{:else\}\s*<BottomSheet[\s\S]*?<\/BottomSheet>/)?.[0] ?? '';

		expect(s).not.toContain('{#if detailOpen && selectedDetail}');
		expect(s).toContain('{#if detailOpen}');
		expect(mobileSheetBlock).toContain('title={selectedDetail?.title}');
		expect(mobileSheetBlock).toContain('{#if selectedDetail}');
		expect(mobileSheetBlock).toContain('detail={selectedDetail}');
	});

	it('hosts the desktop detail rail in the same draggable split as the left rail', () => {
		const s = source();
		const desktopDockBlock =
			s.match(/<div class="map-detail-dock"[\s\S]*?<\/ResizablePaneGroup>\s*<\/div>/)?.[0] ?? '';

		expect(s).toContain(
			"import { ResizablePaneGroup, ResizablePane, ResizableHandle } from '$lib/components/ui/resizable'",
		);
		expect(desktopDockBlock).toMatch(/<ResizablePaneGroup[\s\S]*direction="horizontal"/);
		expect(desktopDockBlock).toMatch(
			/<ResizableHandle[\s\S]*withHandle[\s\S]*class="map-detail-resize-handle"[\s\S]*\/>/,
		);
		expect(desktopDockBlock).toContain('bind:this={rightPanelPane}');
		expect(desktopDockBlock).toContain('defaultSize={51}');
		expect(desktopDockBlock).toContain('minSize={32}');
		expect(desktopDockBlock).toContain('maxSize={74}');
		expect(desktopDockBlock).toContain('collapsible');
		expect(desktopDockBlock).toContain('collapsedSize={9}');
		expect(desktopDockBlock).toContain('resizable');
		expect(desktopDockBlock).toContain('collapsed={rightPanelCollapsed}');
		expect(desktopDockBlock).toContain('ontogglecollapse={toggleRightPanelCollapsed}');
		expect(s).toMatch(/\.map-detail-dock\s*\{[\s\S]*width:\s*min\(44rem, calc\(100% - 4rem\)\)/);
		expect(s).toMatch(/:global\(\.map-detail-resize-handle\)[\s\S]*width:\s*8px/);
	});
});
