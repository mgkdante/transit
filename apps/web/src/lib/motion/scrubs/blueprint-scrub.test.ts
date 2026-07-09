// @vitest-environment happy-dom
// blueprint-scrub.test.ts — the draw-on-scroll contract, pinned deterministically.
//
// The remote-browser matrix can't reliably exercise scroll events (throttled
// tabs starve rAF), so the scrub's behavioral contract lives here: scope law
// (only .blueprint-bg strokes, never interactive icon paths), progress math,
// capture-phase scroll updates from an INNER container, and the destroy
// detach. happy-dom lacks SVG geometry, so getTotalLength + the band rect are
// stubbed explicitly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startBlueprintScrub } from './blueprint-scrub';

const PATH_LENGTH = 200;

function buildBand(bandTop: number): {
	band: HTMLElement;
	artPath: SVGPathElement;
	iconPath: SVGPathElement;
	scroller: HTMLElement;
} {
	const scroller = document.createElement('div');
	const band = document.createElement('div');

	const art = document.createElement('div');
	art.className = 'blueprint-bg';
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	const artPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	svg.append(artPath);
	art.append(svg);

	// Interactive chrome inside the SAME band (the QuietModeButton shape) — the
	// scope law says the scrub must never touch it.
	const button = document.createElement('button');
	const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	iconSvg.append(iconPath);
	button.append(iconSvg);

	band.append(art, button);
	scroller.append(band);
	document.body.append(scroller);

	// Geometry stubs: a 500px band whose top sits at `bandTop` in a 1000px viewport.
	Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
	let top = bandTop;
	band.getBoundingClientRect = () =>
		({ top, bottom: top + 500, height: 500, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
	(band as unknown as { __setTop: (t: number) => void }).__setTop = (t: number) => {
		top = t;
	};
	for (const p of [artPath, iconPath]) {
		(p as unknown as { getTotalLength: () => number }).getTotalLength = () => PATH_LENGTH;
	}
	return { band, artPath, iconPath, scroller };
}

function drawnFraction(path: SVGPathElement): number | null {
	const dash = path.style.strokeDasharray;
	if (!dash) return null;
	const [drawn, total] = dash.split(',').map((v) => parseFloat(v));
	return drawn / total;
}

async function flushRaf(): Promise<void> {
	await new Promise((r) => setTimeout(r, 30));
}

beforeEach(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	document.body.innerHTML = '';
});

describe('startBlueprintScrub', () => {
	it('applies the initial progress to art strokes ONLY (scope law: interactive icons untouched)', () => {
		const { band, artPath, iconPath } = buildBand(100);
		const destroy = startBlueprintScrub(band);
		expect(destroy).toBeTypeOf('function');

		// Band top at 100 in a 1000px viewport: progress = (1000-100)/(1000+500) = 0.6.
		expect(drawnFraction(artPath)).toBeCloseTo(0.6, 2);
		// The button's stroked path is NEVER touched — this is the R3a review bug.
		expect(iconPath.style.strokeDasharray).toBe('');
		destroy?.();
	});

	it('advances the draw on a scroll event from an INNER container (capture phase)', async () => {
		const { band, artPath, scroller } = buildBand(100);
		const setTop = (band as unknown as { __setTop: (t: number) => void }).__setTop;
		const destroy = startBlueprintScrub(band);

		// The reader scrolls the inner container 300px: band top moves to -200 →
		// progress = (1000+200)/1500 = 0.8. Scroll events do not bubble, but the
		// scrub's capture-phase document listener must still observe it.
		setTop(-200);
		scroller.dispatchEvent(new Event('scroll'));
		await flushRaf();
		expect(drawnFraction(artPath)).toBeCloseTo(0.8, 2);

		// Fully past: clamps at 1, never overshoots.
		setTop(-1200);
		scroller.dispatchEvent(new Event('scroll'));
		await flushRaf();
		expect(drawnFraction(artPath)).toBe(1);
		destroy?.();
	});

	it('detaches on destroy (no further updates)', async () => {
		const { band, artPath, scroller } = buildBand(100);
		const setTop = (band as unknown as { __setTop: (t: number) => void }).__setTop;
		const destroy = startBlueprintScrub(band);
		destroy?.();

		setTop(-200);
		scroller.dispatchEvent(new Event('scroll'));
		await flushRaf();
		expect(drawnFraction(artPath)).toBeCloseTo(0.6, 2); // still the initial value
	});

	it('never mounts under prefers-reduced-motion (art stays a fully-drawn default)', () => {
		const { band, artPath } = buildBand(100);
		const mm = vi.spyOn(window, 'matchMedia').mockImplementation(
			(q: string) =>
				({
					matches: q.includes('prefers-reduced-motion'),
					media: q,
					addEventListener: () => {},
					removeEventListener: () => {},
				}) as unknown as MediaQueryList,
		);
		const destroy = startBlueprintScrub(band);
		expect(destroy).toBeUndefined();
		// No dasharray was ever written — the stroke renders complete by default.
		expect(artPath.style.strokeDasharray).toBe('');
		mm.mockRestore();
	});

	it('never mounts at ≤1023px viewports', () => {
		const { band } = buildBand(100);
		const mm = vi.spyOn(window, 'matchMedia').mockImplementation(
			(q: string) =>
				({
					matches: q.includes('max-width'),
					media: q,
					addEventListener: () => {},
					removeEventListener: () => {},
				}) as unknown as MediaQueryList,
		);
		expect(startBlueprintScrub(band)).toBeUndefined();
		mm.mockRestore();
	});

	it('declines a band with no measurable art strokes', () => {
		const band = document.createElement('div');
		document.body.append(band);
		expect(startBlueprintScrub(band)).toBeUndefined();
	});
});
