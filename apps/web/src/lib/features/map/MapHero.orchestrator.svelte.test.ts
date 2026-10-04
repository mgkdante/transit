import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/lib/features/map/MapHero.svelte'), 'utf-8');
const layerModulesSource = readFileSync(
	resolve(process.cwd(), 'src/lib/features/map/mapLayerModules.ts'),
	'utf-8',
);
const runtimeSource = readFileSync(
	resolve(process.cwd(), 'src/lib/features/map/mapRuntime.svelte.ts'),
	'utf-8',
);
const script = source.match(/<script(?:\s[^>]*)?>\r?\n([\s\S]*?)\r?\n<\/script>/u)?.[1];
const obsoleteM6hRouteExit = 'attachMapDetailRouteExit';
const mapStage = source.match(/<MapStage\s[\s\S]*?\/>/u)?.[0];
const nearMeDependencies = script?.match(
	/const nearMeController = createMapNearMeController\(\{([\s\S]*?)\r?\n\t\}\);\r?\n\tconst focusController/u,
);
const selectionLeaseEffect = script?.match(
	/\$effect\(\(\) => \{\s*const release =\s*selected\?\.kind === 'vehicle'[\s\S]*?\r?\n\t\}\);/u,
)?.[0];
const browserApiAccess =
	/\b(?:navigator\s*(?:\.\s*geolocation|\[\s*['"]geolocation['"]\s*\])|(?:globalThis|window)\s*(?:\.\s*fetch|\[\s*['"]fetch['"]\s*\])|fetch\s*\()/gu;

function codeOnly(text: string): string {
	return text
		.replace(/<style[\s\S]*?<\/style>/gu, '')
		.replace(/<!--[\s\S]*?-->/gu, '')
		.replace(/\/\*[\s\S]*?\*\//gu, '')
		.replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1');
}
const forbiddenIdentifiers = /\b(?:navigator|geolocation|fetch)\b/gu;

describe('MapHero orchestrator — structural law', () => {
	it('owns no accepted-navigation ledger or recovery pass', () => {
		expect(source).not.toContain('mapDetailNavigationLifecycle');
		expect(source).not.toContain('navigating.subscribe');
		expect(source).not.toContain('urlCoordinator.currentIntent');
		expect(source).not.toContain('observedPageUrl');
		expect(source).toContain('urlCoordinator.settle(url)');
	});

	it('delegates outward lifecycle signals', () => {
		expect(script).toBeDefined();
		expect(script).not.toContain(obsoleteM6hRouteExit);
		expect(script).toContain('function onMapIdle(): void');
		expect(script).toContain('function onMapFailure(failure: MapStageFailure | null): void');
	});

	it('uses one normal-script URL ingestion seam behind the shared coordinator', () => {
		expect(source.match(/<script(?:\s[^>]*)?>/gu)).toHaveLength(1);
		expect(source).not.toMatch(/<script[^>]*context=["']module["']/u);
		expect(source).not.toContain('afterNavigate');
		expect(source.match(/filters\.replaceFromUrl\(/gu)).toHaveLength(1);
		expect(source).toContain('const urlIdentity = `${url.pathname}${url.search}`');
		expect(source).toContain('urlCoordinator.settle(url)');
		expect(source.indexOf('const urlCoordinator = createMapUrlCoordinator')).toBeLessThan(
			source.indexOf('const nearMeController = createMapNearMeController'),
		);
		expect(source).toContain('urlCoordinator.writeFilters');
		expect(source).toContain('goto: urlCoordinator.goto');
	});

	it('uses NO paneforge / resizable pane group (the map is full-bleed, never a pane)', () => {
		expect(source).not.toContain('ResizablePaneGroup');
		expect(source).not.toContain('ResizablePane');
		expect(source).not.toContain('ResizableHandle');
		expect(source).not.toContain("from '@yesid/ui/resizable'");
		expect(source).not.toContain('onMapPaneResize');
		expect(source).not.toContain('onPaneLayoutChange');
	});

	it('installs NO ResizeObserver in the orchestrator (MapStage owns the only one)', () => {
		expect(source).not.toContain('new ResizeObserver');
	});

	it('never re-fits / resizes the map from a panel change (the collapse toggle is a pure flip)', () => {
		const toggle = source.match(/function toggleDetailCollapsed[\s\S]*?\n\t}/)?.[0] ?? '';
		expect(toggle).toContain('detailCollapsed = !detailCollapsed');
		expect(toggle).not.toMatch(/map\??\.resize|fitBounds|setCenter|setZoom|easeTo|flyTo|jumpTo/);
	});

	it('keeps the hydration-safe layout snapshot independent of the hydration-flipping store', () => {
		const fitPaddingBlock = source.match(/const mapFitPadding = \$derived[\s\S]*?\);/)?.[0] ?? '';
		expect(source).toContain('let isDesktopLayout = $state(isDesktopViewport())');
		expect(fitPaddingBlock).toContain('deriveMapFitPadding(isDesktopLayout, mapWidthPx)');
		expect(fitPaddingBlock).not.toContain('layout.isDesktop');
	});

	it('wires hot-first-paint loading and extracted camera framing into MapStage', () => {
		expect(mapStage).toBeDefined();
		expect(mapStage).toContain('basemapLoader={({ signal }) => getBasemap({ signal })}');
		expect(mapStage).not.toContain('basemap={');
		expect(mapStage).toContain('center={framing.center}');
		expect(mapStage).toContain('bounds={framing.bounds}');
		expect(mapStage).toContain('maxBounds={framing.maxBounds}');
		expect(mapStage).toContain('fitPadding={mapFitPadding}');
		expect(mapStage).toContain('onidle={onMapIdle}');
		expect(mapStage).toContain('onerror={onMapFailure}');
		expect(mapStage).toContain('onbeforeremove={runtime.release}');
		expect(mapStage).not.toContain('layout.isDesktop');
	});

	it('composes the extracted children (a thin orchestrator, not a god-file)', () => {
		expect(source).toContain("import MapSurfaceCanvasLayer from './MapSurfaceCanvasLayer.svelte'");
		expect(source).toContain("import MapOverlayChrome from './MapOverlayChrome.svelte'");
		expect(source).toContain("import MapDetailOverlay from './MapDetailOverlay.svelte'");
		expect(source).toContain("import MapMobileDetailSheet from './MapMobileDetailSheet.svelte'");
		expect(source).toContain('<MapSurfaceCanvasLayer {mapBody} />');
		expect(source).toContain('<MapOverlayChrome');
	});

	it('delegates selection runes and transitions to the real selection controller', () => {
		expect(source).toContain(
			"import { createMapSelectionController } from './mapSelectionController.svelte'",
		);
		expect(source).toContain('const selectionController = createMapSelectionController();');
		expect(source).not.toContain(obsoleteM6hRouteExit);
		expect(source).toMatch(
			/function addSelectionFilter[\s\S]*?filters\.applyChips\(chips, SELECTION_WRITE\)/u,
		);
		expect(source).toMatch(
			/function commitPickedSelection[\s\S]*?addSelectionFilter\(next\)[\s\S]*?selectionController\.selectPicked\(next\)/u,
		);
		expect(source).toMatch(
			/function selectAlertRelated[\s\S]*?filters\.applyChips\(chips, SELECTION_WRITE\)/u,
		);
		expect(source).toMatch(/function selectPickedFeature[\s\S]*?commitPickedSelection\(next\)/u);
		expect(source).toMatch(
			/function selectNearbyStop[\s\S]*?commitPickedSelection\(\{ kind: 'stop', id: stop\.id \}\)/u,
		);
		expect(source).not.toMatch(/let (?:selected|hovered|selectionStack|detailOpen) = \$state/u);
		expect(source).not.toContain('function promoteVehicleRoute');
	});

	it('acquires fetch and geolocation only in the sanctioned near-me dependency literal', () => {
		expect(nearMeDependencies).toBeDefined();
		expect(nearMeDependencies?.[1]).toContain(
			'fetch: (input, init) => globalThis.fetch(input, init)',
		);
		expect(nearMeDependencies?.[1]).toContain(
			"getGeolocation: () => (typeof navigator === 'undefined' ? null : navigator['geolocation'])",
		);
		expect(nearMeDependencies?.[1].match(browserApiAccess)).toEqual([
			'globalThis.fetch',
			"navigator['geolocation']",
		]);

		expect(codeOnly(nearMeDependencies![1]).match(forbiddenIdentifiers)).toEqual([
			'fetch',
			'fetch',
			'navigator',
			'navigator',
			'geolocation',
		]);

		const outsideDependencies = codeOnly(source.replace(nearMeDependencies![0], ''));
		expect(outsideDependencies.match(forbiddenIdentifiers)).toEqual(null);
	});

	it('wires M1 live resilience at the registry and map call sites without widening consumers', () => {
		expect(source).toContain("families: ['vehicles', 'alerts']");
		expect(selectionLeaseEffect).toContain("live.subscribeFamilies(['trips'])");
		expect(selectionLeaseEffect).toContain("live.subscribeFamilies(['departures'])");
		expect(source).toContain('createSelectionGrace<MapSelectionDetailModel>()');
		expect(layerModulesSource).toContain('tickKey: vehicles.tickKey');
		expect(layerModulesSource).toContain('stale: vehicles.stale');
		expect(runtimeSource).toContain('feed.vehicles.stale');
		expect(runtimeSource).toContain('overlay?.setScene(');
		expect(source).toContain('data-motion-stale={live.vehiclesIsStale}');
		expect(source).toContain('live.familyStates.departures.retainedGeneration != null');
		expect(source).toContain("family.phase === 'failed' || family.consecutiveFailures > 0");
		expect(source).toContain('getStopsIndexSlim({ signal })');
		expect(source).toContain('getRoute(id, { signal })');
		expect(source).toContain('getStop(id, { signal })');
	});

	it('routes the detail to the desktop OVERLAY vs the mobile SHEET by layout', () => {
		expect(source).toMatch(
			/\{#if layout\.isDesktop && detailOpen\}[\s\S]*<MapDetailOverlay[\s\S]*\{\/if\}/,
		);
		expect(source).toMatch(
			/\{#if detailOpen && !layout\.isDesktop\}[\s\S]*<MapMobileDetailSheet[\s\S]*\{\/if\}/,
		);
		expect(source).toMatch(
			/bind:open=\{\s*\(\) => selectionController\.detailOpen,\s*\(next\) => \{\s*if \(next\) selectionController\.detailOpen = true;\s*else closeDetail\(\);/u,
		);
	});
});
