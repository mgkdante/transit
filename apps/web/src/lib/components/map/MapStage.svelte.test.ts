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
		expect(s).toContain('...mapViewportOptions(bounds, fitPadding)');
		expect(s).toContain(
			'function fitKey(nextBounds: readonly number[] | undefined, nextPadding: MapFitPadding): string',
		);
		expect(s).toContain('let activeFitKey: string | null = null');
		expect(s).toContain('const nextFitKey = fitKey(bounds, fitPadding)');
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

	it('keeps mobile attribution visible in compact and expanded states', () => {
		const s = source();

		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*z-index:\s*12/,
		);
		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-attrib-inner\)\s*\{[\s\S]*white-space:\s*normal/,
		);
		expect(s).toMatch(
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
