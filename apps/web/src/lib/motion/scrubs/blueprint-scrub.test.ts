// @vitest-environment happy-dom

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

	const button = document.createElement('button');
	const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	iconSvg.append(iconPath);
	button.append(iconSvg);

	band.append(art, button);
	scroller.append(band);
	document.body.append(scroller);

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

		expect(drawnFraction(artPath)).toBeCloseTo(0.6, 2);
		expect(iconPath.style.strokeDasharray).toBe('');
		destroy?.();
	});

	it('advances the draw on a scroll event from an INNER container (capture phase)', async () => {
		const { band, artPath, scroller } = buildBand(100);
		const setTop = (band as unknown as { __setTop: (t: number) => void }).__setTop;
		const destroy = startBlueprintScrub(band);

		setTop(-200);
		scroller.dispatchEvent(new Event('scroll'));
		await flushRaf();
		expect(drawnFraction(artPath)).toBeCloseTo(0.8, 2);

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
		expect(drawnFraction(artPath)).toBeCloseTo(0.6, 2);
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
