import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { compile } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';

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
			/@media \(max-width: 1023\.98px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*right:\s*0\.75rem/,
		);
		expect(s).toMatch(
			/@media \(max-width: 1023\.98px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*bottom:\s*calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
		);
		expect(s).toMatch(
			/@media \(max-width: 1023\.98px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*max-width:\s*calc\(100% - 1\.5rem\)/,
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
		// The credit's margin is now zeroed unconditionally on the control itself
		// (M6f-2 F16), so the narrow-viewport duplicate is gone.
		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right \.maplibregl-ctrl\)\s*\{\s*margin:\s*0/,
		);
		expect(s).toMatch(
			/@media \(max-width: 1023\.98px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-attrib\)\s*\{[\s\S]*max-width:\s*100%/,
		);
		expect(s).toMatch(
			/@media \(max-width: 1023\.98px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-attrib\.maplibregl-compact-show\)\s*\{[\s\S]*max-width:\s*100%/,
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

	// M6f-2 F19 RECEIPT (source contract; the effective touch area is the browser
	// lane's to measure). maplibre's own button is 24x24 — too small for a control
	// that now carries a licence obligation — so the hit area is grown to 44px
	// around it without growing the visible chrome.
	it('gives the collapsed credit a 44px hit target without growing the control', () => {
		const s = source();
		const rule =
			s.match(
				/\.map-stage :global\(\.maplibregl-ctrl-attrib-button\)::after\s*\{[\s\S]*?\n\t\}/,
			)?.[0] ?? '';
		expect(rule).toContain('width: 44px');
		expect(rule).toContain('height: 44px');
		expect(rule).toContain('position: absolute');
		expect(rule).toContain('transform: translate(-50%, -50%)');
		// The collapsed control keeps its own compact box; only the tap area grows.
		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-attrib\.maplibregl-compact\)\s*\{[\s\S]*min-height:\s*1\.75rem/,
		);
	});

	// M6f-2 F16 RECEIPT — a CASCADE/COMPUTED-STYLE contract, NOT geometry. It
	// resolves the declared right inset of the location peel and of the credit
	// through the real cascade (maplibre's own stylesheet included) at each width.
	// It cannot and does not measure laid-out pixels; that is the browser lane's.
	//
	// RED before the fix, for two independent reasons:
	//   1. maplibre ships `.maplibregl-ctrl-bottom-right .maplibregl-ctrl {
	//      margin: 0 10px 10px 0 }`, pushing the credit's visible right edge 10px
	//      inside the container inset the peel sits exactly on;
	//   2. the credit's compact rules were still on the OLD 768px line while every
	//      other map surface had converged on 1024 — so right through the
	//      769–1023 band the credit kept the desktop inset and the peel the
	//      compact one. That band is swept explicitly here.
	describe('F16 — one right edge for the location peel and the credit', () => {
		const scopeless = (path: string): string =>
			compile(readFileSync(resolve(process.cwd(), path), 'utf8'), {
				filename: path,
				generate: 'client',
				css: 'external',
			}).css!.code.replace(/\.svelte-[0-9a-z]+/g, '');

		const happyWindow = window as typeof window & {
			happyDOM: { setInnerWidth(widthPx: number): void };
		};

		function mount(): { near: HTMLElement; creditBox: HTMLElement; creditCtrl: HTMLElement } {
			const style = document.createElement('style');
			// Component CSS FIRST, vendor CSS LAST: the override must win on
			// specificity alone, never on load order (the vendor sheet is imported
			// dynamically at mount, so its order is not ours to guarantee).
			style.textContent = [
				scopeless('src/lib/components/map/MapStage.svelte'),
				scopeless('src/lib/features/map/MapNearMeControl.svelte'),
				readFileSync(
					createRequire(import.meta.url).resolve('maplibre-gl/dist/maplibre-gl.css'),
					'utf8',
				),
			].join('\n');
			document.head.append(style);

			const stage = document.createElement('div');
			stage.className = 'map-stage';
			stage.innerHTML = `
				<div class="map-near"><button class="map-near-toggle"></button></div>
				<div class="maplibregl-ctrl-bottom-right">
					<details class="maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact"></details>
				</div>`;
			document.body.append(stage);
			return {
				near: stage.querySelector<HTMLElement>('.map-near')!,
				creditBox: stage.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-right')!,
				creditCtrl: stage.querySelector<HTMLElement>('.maplibregl-ctrl-attrib')!,
			};
		}

		afterEach(() => {
			document.body.replaceChildren();
			document.head.querySelectorAll('style').forEach((node) => node.remove());
		});

		it.each([320, 360, 390, 768, 769, 900, 1023, 1024, 1280, 1366, 1440])(
			'anchors both to the same right inset at %dpx',
			(widthPx) => {
				happyWindow.happyDOM.setInnerWidth(widthPx);
				const { near, creditBox, creditCtrl } = mount();

				// Same declared inset from the right edge of the stage...
				expect(getComputedStyle(creditBox).right).toBe(getComputedStyle(near).right);
				// ...and nothing between that inset and the credit's own box, so the
				// two insets are the two visible edges.
				expect(getComputedStyle(creditCtrl).marginRight).toBe('0px');
			},
		);

		// The controls peel is the bottom row's LEFT member by design, so it shares
		// a BASELINE with the credit rather than a right edge. Stated, not assumed.
		it('states why the controls peel differs: it is left-anchored on the shared baseline', () => {
			const pill = readFileSync(
				resolve(process.cwd(), 'src/lib/features/map/MapFilterPill.svelte'),
				'utf-8',
			);
			const containerRule = pill.match(/\.map-filter-pill-container\s*\{[\s\S]*?\n\t\}/)?.[0] ?? '';
			expect(containerRule).toContain('left: 0.75rem');
			expect(containerRule).not.toContain('right:');
			// Both peels rest on the one baseline token; the credit's own anchor sits
			// below it at 1rem + the safe area, and expands UPWARD from there.
			expect(containerRule).toContain('bottom: var(--map-mobile-control-bottom)');
			expect(source()).toMatch(
				/@media \(max-width: 1023\.98px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*bottom:\s*calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
			);
		});
	});
});
