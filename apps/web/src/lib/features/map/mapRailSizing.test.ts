import { describe, expect, it } from 'vitest';
import { mapRailSizing, RAIL_REM } from './mapRailSizing';

// B1 — the right rail must be GENUINELY narrow and responsive: a constant-rem
// rail (22rem floor, 34rem ceiling, 3.7rem collapsed strip) re-expressed as the
// percent paneforge consumes, so the SAME pixel width reads across desktop
// widths. The GL canvas can't be screenshotted from CI, so this pure math is the
// proof the sizing is correct and never lets the rail eat the map.

const PX_PER_REM = 16;

/** Convert a returned percent back to px at a given hero width. */
function pct(percent: number, heroWidthPx: number): number {
	return (percent / 100) * heroWidthPx;
}

describe('mapRailSizing', () => {
	const DESKTOP_WIDTHS = [1024, 1280, 1600];

	it('maps the rem floor/ceiling to a CONSTANT pixel width across desktop widths', () => {
		for (const w of DESKTOP_WIDTHS) {
			const s = mapRailSizing(w);
			// minSize% → ~22rem (352px), maxSize% → ~34rem (544px), within rounding.
			expect(pct(s.minSize, w)).toBeCloseTo(RAIL_REM.min * PX_PER_REM, -1);
			expect(pct(s.maxSize, w)).toBeCloseTo(RAIL_REM.max * PX_PER_REM, -1);
			expect(pct(s.defaultSize, w)).toBeCloseTo(RAIL_REM.default * PX_PER_REM, -1);
			expect(pct(s.collapsedSize, w)).toBeCloseTo(RAIL_REM.collapsed * PX_PER_REM, -1);
		}
	});

	it('keeps the collapsed strip thin (~3.7rem), never a wide strip', () => {
		for (const w of DESKTOP_WIDTHS) {
			const s = mapRailSizing(w);
			// The OLD bug shipped a ~115px collapsed strip; the icon strip is ~59px.
			expect(pct(s.collapsedSize, w)).toBeLessThan(72);
			expect(pct(s.collapsedSize, w)).toBeGreaterThan(48);
		}
	});

	it('gives the expanded floor a real narrow width (~352px), not the old ~410px', () => {
		const s = mapRailSizing(1280);
		expect(pct(s.minSize, 1280)).toBeLessThan(360);
		expect(pct(s.minSize, 1280)).toBeGreaterThan(344);
	});

	it('never lets the rail eat the map: at 1024 the map keeps ~47% even at the rail ceiling', () => {
		const s = mapRailSizing(1024);
		// Map pane percent = 100 - rail. Even at the WIDEST rail the map stays > 45%.
		expect(100 - s.maxSize).toBeGreaterThan(45);
		// And at the floor the rail itself never exceeds ~35% at the narrowest desktop.
		expect(s.minSize).toBeLessThan(36);
	});

	it('preserves the ordering invariant collapsed <= min <= default <= max at every width', () => {
		for (const w of [320, 600, 1024, 1280, 1600, 2560]) {
			const s = mapRailSizing(w);
			expect(s.collapsedSize).toBeLessThanOrEqual(s.minSize);
			expect(s.minSize).toBeLessThanOrEqual(s.defaultSize);
			expect(s.defaultSize).toBeLessThanOrEqual(s.maxSize);
		}
	});

	it('falls back to a sane 1280 desktop default for a non-positive (pre-measure) width', () => {
		expect(mapRailSizing(0)).toEqual(mapRailSizing(1280));
		expect(mapRailSizing(-5)).toEqual(mapRailSizing(1280));
	});

	it('responds to width: a narrower hero yields a LARGER rail percent for the same rems', () => {
		// Same 22rem floor is a bigger share of a narrow hero than a wide one.
		expect(mapRailSizing(1024).minSize).toBeGreaterThan(mapRailSizing(1600).minSize);
		expect(mapRailSizing(1024).collapsedSize).toBeGreaterThan(mapRailSizing(1600).collapsedSize);
	});
});
