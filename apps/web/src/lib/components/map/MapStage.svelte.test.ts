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

	it('resolves the basemap at construction for a hot first paint with no post-mount setStyle wipe (B2)', () => {
		const s = source();

		expect(s).toContain(
			'basemapLoader?: (ctx: { signal: AbortSignal }) => Promise<BasemapFile | null>',
		);
		expect(s).toContain('basemapLoader');
		expect(s).toContain('const basemapPromise = Promise.resolve()');
		expect(s).toContain('basemapLoader({ signal: attempt.controller.signal })');
		expect(s).toContain('const initialBasemap = await basemapPromise');
		expect(s).toContain('activeStyleKey = styleKey(initialBasemap)');
		expect(s).toMatch(/resolveBasemapStyle\(\s*\{ basemap: initialBasemap \? '' : null \}/);
		expect(s).toContain('if (b === undefined)');
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

	// that now carries a licence obligation — so the hit area is grown to 44px
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
		expect(s).toMatch(
			/\.map-stage\s*:global\(\.maplibregl-ctrl-attrib\.maplibregl-compact\)\s*\{[\s\S]*min-height:\s*1\.75rem/,
		);
	});

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

				expect(getComputedStyle(creditBox).right).toBe(getComputedStyle(near).right);
				expect(getComputedStyle(creditCtrl).marginRight).toBe('0px');
			},
		);

		it('states why the controls peel differs: it is left-anchored on the shared baseline', () => {
			const pill = readFileSync(
				resolve(process.cwd(), 'src/lib/features/map/MapFilterPill.svelte'),
				'utf-8',
			);
			const containerRule = pill.match(/\.map-filter-pill-container\s*\{[\s\S]*?\n\t\}/)?.[0] ?? '';
			expect(containerRule).toContain('left: 0.75rem');
			expect(containerRule).not.toContain('right:');
			expect(containerRule).toContain('bottom: var(--map-mobile-control-bottom)');
			expect(source()).toMatch(
				/@media \(max-width: 1023\.98px\)[\s\S]*\.map-stage\s*:global\(\.maplibregl-ctrl-bottom-right\)\s*\{[\s\S]*bottom:\s*calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
			);
		});
	});
});
