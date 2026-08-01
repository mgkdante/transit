import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MapStage', () => {
	const source = () =>
		readFileSync(resolve(process.cwd(), 'src/lib/components/map/MapStage.svelte'), 'utf-8');

	it('reserves a bottom-right attribution slot below the near-me control', () => {
		const s = source();

		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*right:\s*calc\(var\(--map-detail-offset, 0rem\) \+ 1rem\)/,
		);
		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*bottom:\s*1rem/,
		);
		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*transition:\s*right var\(--duration-normal\) var\(--ease-out\)/,
		);
		expect(s).toMatch(
			/@media \(max-width: 768px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*right:\s*0\.75rem/,
		);
		expect(s).toMatch(
			/@media \(max-width: 768px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*bottom:\s*calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
		);
		expect(s).toMatch(
			/@media \(max-width: 768px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*max-width:\s*calc\(100% - 1\.5rem\)/,
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

		// A loader prop, started before the import barriers and awaited before the Map is built.
		expect(s).toContain(
			'basemapLoader?: (ctx: { signal: AbortSignal }) => Promise<BasemapFile | null>',
		);
		expect(s).toContain('basemapLoader');
		expect(s).toContain('const basemapPromise = Promise.resolve()');
		expect(s).toContain('basemapLoader({ signal: attempt.controller.signal })');
		expect(s).toContain('const initialBasemap = await basemapPromise');
		// The resolved basemap seeds BOTH the constructor style AND the swap baseline,
		// so the swap effect treats it as the initial style (no immediate setStyle).
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

	it('wraps mobile attribution inside the visible map in compact and expanded states', () => {
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
			/@media \(max-width: 768px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-attrib\.maplibregl-compact\)\s*\{[\s\S]*margin:\s*0/,
		);
		expect(s).toMatch(
			/@media \(max-width: 768px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-attrib\)\s*\{[\s\S]*max-width:\s*100%/,
		);
		expect(s).toMatch(
			/@media \(max-width: 768px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-attrib\.maplibregl-compact-show\)\s*\{[\s\S]*max-width:\s*100%/,
		);
	});

	it('keeps mobile map controls above expanded attribution through one shared clearance', () => {
		const hero = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapHero.svelte'),
			'utf-8',
		);
		const nearMe = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapNearMeControl.svelte'),
			'utf-8',
		);
		const controls = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilterPill.svelte'),
			'utf-8',
		);

		expect(hero).toMatch(
			/--map-mobile-control-bottom:\s*calc\(5\.25rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
		);
		expect(nearMe).toMatch(
			/@media \(max-width: 1023\.98px\)[\s\S]*bottom:\s*var\(--map-mobile-control-bottom\)/,
		);
		expect(controls).toMatch(
			/\.map-filter-pill-container\s*\{[\s\S]*bottom:\s*var\(--map-mobile-control-bottom\)/,
		);
	});
});
