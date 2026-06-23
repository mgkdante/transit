/**
 * MapHero — ORCHESTRATOR structural-law suite (source-string).
 *
 * After the de-monolith, MapHero is a THIN ORCHESTRATOR: it composes the child
 * components (MapSurfaceCanvasLayer, MapOverlayChrome, MapDetailOverlay,
 * MapMobileDetailSheet) and owns only cross-cutting state. The rendered DOM and the
 * overlay LAW are render-tested on those CHILD components (MapDetailOverlay /
 * MapOverlayChrome / MapHeadTitle / MapMobileDetailSheet / MapSurfaceCanvasLayer
 * *.svelte.test.ts — those mount the leaves and assert the real DOM).
 *
 * The ORCHESTRATOR itself is guarded here by reading its source: mounting the full
 * MapHero in jsdom is impractical (its heavy import tree blocks vitest collection),
 * and these checks assert COMPOSITION + the ABSENCE of anti-patterns (no paneforge,
 * no ResizeObserver, no panel-driven map resize) which have no DOM footprint anyway.
 * This is a small, focused guard — NOT the old 161-assertion grep harness.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/lib/features/map/MapHero.svelte'), 'utf-8');

describe('MapHero orchestrator — structural law', () => {
	it('uses NO paneforge / resizable pane group (the map is full-bleed, never a pane)', () => {
		expect(source).not.toContain('ResizablePaneGroup');
		expect(source).not.toContain('ResizablePane');
		expect(source).not.toContain('ResizableHandle');
		expect(source).not.toContain("from '$lib/components/ui/resizable'");
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

	it('keeps the hydration-safe one-shot camera padding (not the hydration-flipping store)', () => {
		const fitPaddingBlock = source.match(/const mapFitPadding = \$derived[\s\S]*?\);/)?.[0] ?? '';
		expect(source).toContain('let isDesktopLayout = $state(isDesktopViewport())');
		expect(fitPaddingBlock).toContain('isDesktopLayout && fitWidthPx > 0');
		expect(fitPaddingBlock).not.toContain('layout.isDesktop');
	});

	it('composes the extracted children (a thin orchestrator, not a god-file)', () => {
		expect(source).toContain("import MapSurfaceCanvasLayer from './MapSurfaceCanvasLayer.svelte'");
		expect(source).toContain("import MapOverlayChrome from './MapOverlayChrome.svelte'");
		expect(source).toContain("import MapDetailOverlay from './MapDetailOverlay.svelte'");
		expect(source).toContain("import MapMobileDetailSheet from './MapMobileDetailSheet.svelte'");
		expect(source).toContain('<MapSurfaceCanvasLayer {mapBody} />');
		expect(source).toContain('<MapOverlayChrome');
	});

	it('routes the detail to the desktop OVERLAY vs the mobile SHEET by layout', () => {
		expect(source).toMatch(
			/\{#if layout\.isDesktop && detailOpen\}[\s\S]*<MapDetailOverlay[\s\S]*\{\/if\}/,
		);
		expect(source).toMatch(
			/\{#if detailOpen && !layout\.isDesktop\}[\s\S]*<MapMobileDetailSheet[\s\S]*\{\/if\}/,
		);
	});
});
