import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MapStage', () => {
	const source = () =>
		readFileSync(resolve(process.cwd(), 'src/lib/components/map/MapStage.svelte'), 'utf-8');

	it('does not re-apply the same camera during chrome-only re-renders', () => {
		const s = source();

		expect(s).toContain('fitPadding?: MapFitPadding');
		expect(s).toContain('fitPadding = 40');
		// maxBounds (optional, looser than the fit bounds) is threaded through both
		// viewport-option call sites so a left fit-padding can reveal west overflow.
		expect(s).toContain('maxBounds?: readonly number[]');
		expect(s).toContain('...mapViewportOptions(bounds, fitPadding, maxBounds)');
		expect(s).toContain(
			'function fitKey(nextBounds: readonly number[] | undefined, nextPadding: MapFitPadding): string',
		);
		expect(s).toContain('let activeFitKey: string | null = null');
		// fit key folds maxBounds in so a band tweak re-runs the effect, and the
		// new maxBounds is pushed via setMaxBounds before the camera refit.
		expect(s).toContain('fitKey(bounds, fitPadding)');
		expect(s).toContain("maxBounds?.join(',')");
		expect(s).toContain('m.setMaxBounds(viewport.maxBounds)');
		expect(s).toContain(
			'm.fitBounds(viewport.bounds, { ...viewport.fitBoundsOptions, duration: 0 })',
		);
		expect(s).toContain('let activeCameraKey: string | null = null');
		expect(s).toContain(
			'function cameraKey(nextCenter: [number, number], nextZoom: number): string',
		);
		expect(s).toContain('const nextCameraKey = cameraKey(nextCenter, nextZoom)');
		expect(s).toContain('if (activeCameraKey === nextCameraKey) return');
		expect(s).toContain('activeCameraKey = nextCameraKey');
		expect(s).toContain('m.jumpTo({ center: nextCenter, zoom: nextZoom })');
	});

	it('reserves a bottom-right attribution slot below the near-me control', () => {
		const s = source();

		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*right:\s*calc\(var\(--map-detail-offset, 0rem\) \+ 1rem\)/,
		);
		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*bottom:\s*1rem/,
		);
		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*transition:\s*right 180ms/,
		);
		expect(s).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*right:\s*0\.75rem/,
		);
		expect(s).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*bottom:\s*calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
		);
		expect(s).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*max-width:\s*calc\(100vw - 5\.25rem\)/,
		);
	});

	// B2 — the basemap is resolved BEFORE the Map is constructed (awaited inside
	// onMount via `basemapLoader`) and baked into the constructor style, so the
	// first paint is HOT. The swap baseline is seeded to that basemap so the
	// post-mount style effect does NOT fire a setStyle wipe on first load — it only
	// swaps on a genuine LATER theme/pointer change. A not-yet-settled basemap prop
	// (undefined) is ignored so its later null→file settle never triggers a wipe.
	it('resolves the basemap at construction for a hot first paint with no post-mount setStyle wipe (B2)', () => {
		const s = source();

		// A loader prop, awaited before the Map is built.
		expect(s).toContain('basemapLoader?: () => Promise<BasemapFile | null>');
		expect(s).toContain('basemapLoader');
		expect(s).toContain('await basemapLoader().catch(() => null)');
		// The resolved basemap seeds BOTH the constructor style AND the swap baseline,
		// so the swap effect treats it as the initial style (no immediate setStyle).
		expect(s).toContain('const initialBasemap: BasemapFile | null = basemapLoader');
		expect(s).toContain('activeStyleKey = styleKey(initialBasemap)');
		expect(s).toMatch(/resolveBasemapStyle\(\s*\{ basemap: initialBasemap \? '' : null \}/);
		// The swap effect ignores `undefined` (deferred to the loader) so a transient
		// null from a not-yet-settled resource never downgrades the painted basemap.
		expect(s).toContain('if (b === undefined)');
		// The baseline state is declared up top (seeded in onMount), not only beside
		// the effect, and the effect no longer redundantly seeds on its first run for
		// the loader path.
		expect(s).toContain('let styleInited = false');
		expect(s).toContain('styleInited = true;');
	});

	it('keeps mobile attribution visible in compact and expanded states', () => {
		const s = source();

		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*z-index:\s*12/,
		);
		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-attrib-inner\)\s*\{[\s\S]*white-space:\s*nowrap/,
		);
		expect(s).not.toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-attrib-inner\)\s*\{[\s\S]*overflow-wrap:\s*anywhere/,
		);
		expect(s).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-attrib\.maplibregl-compact\)\s*\{[\s\S]*margin:\s*0/,
		);
		expect(s).toMatch(
			/@media \(max-width: 760px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-attrib\.maplibregl-compact-show\)\s*\{[\s\S]*max-width:\s*calc\(100vw - 5\.25rem\)/,
		);
	});
});
