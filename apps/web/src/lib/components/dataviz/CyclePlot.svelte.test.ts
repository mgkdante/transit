// CyclePlot.svelte.test.ts — locks the P7 weekday-seasonality cycle plot contract:
// seven Mon→Sun panels share ONE fixed y-axis; a panel with ≥2 real points draws an
// across-weeks series + the defining per-panel MEAN line ('cycle' mode), while the
// contract's one-value-per-weekday shape degrades to a single fixed-domain magnitude
// bar per weekday ('bars' mode) — never a fabricated line through one point. The severe
// second mark is gated (n≥5) + carries a glyph + severity-scale colour (never colour-only),
// the observation count renders a visible n=, the steepest-trend panel is annotated, an
// empty weekday routes through the honest-absence chip, and a fully-absent figure routes
// the whole figure through it.

import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import CyclePlot from './CyclePlot.svelte';
import type { CyclePlotPanel } from './CyclePlot.svelte';

const DELAY_DOMAIN = [0, 6] as const;
const SEVERE_DOMAIN = [0, 35] as const;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const FULL = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday',
] as const;

/** Build a 7-panel frame; `make(iso)` shapes each weekday (1-based iso). */
function frame(make: (iso: number) => Partial<CyclePlotPanel>): CyclePlotPanel[] {
	return [1, 2, 3, 4, 5, 6, 7].map((iso) => ({
		label: DAYS[iso - 1],
		fullLabel: FULL[iso - 1],
		points: [],
		severePct: null,
		severity: 'watch',
		observationCount: null,
		...make(iso),
	}));
}

const base = {
	domain: DELAY_DOMAIN,
	severeDomain: SEVERE_DOMAIN,
	locale: 'en' as const,
	ariaLabel: 'Cycle plot of mean delay by day of week',
	meanLabel: (v: string) => `Mean ${v}`,
	severeLabel: (v: string) => `Severe ${v}`,
	obsLabel: (n: number) => `n=${n}`,
	steepestLabel: (day: string, delta: string) => `Steepest swing: ${day} (${delta})`,
	unit: ' min',
};

const fig = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="cycle-plot"]');

describe('CyclePlot — weekday cycle plot on a shared fixed y-axis', () => {
	it("degrades to 'bars' mode (one bar per weekday) when each weekday carries a single value — no fabricated series", () => {
		const panels = frame((iso) => ({
			points: [iso * 0.5], // one value per weekday → single-value shape
			observationCount: 40,
		}));
		const { container } = render(CyclePlot, { props: { ...base, panels } });
		const f = fig(container)!;
		expect(f).not.toBeNull();
		expect(f.getAttribute('data-mode')).toBe('bars');
		// One magnitude bar per weekday on the fixed domain; NO across-weeks mean line.
		expect(f.querySelectorAll('[data-slot="cycle-plot-bar"]').length).toBe(7);
		expect(f.querySelector('[data-slot="cycle-plot-mean"]')).toBeNull();
	});

	it("draws a 'cycle' mode mean line per panel when a real across-weeks series is present", () => {
		const panels = frame(() => ({
			points: [2, 3, 2.5, 4], // a true across-weeks series (≥2 points)
			observationCount: 120,
		}));
		const { container } = render(CyclePlot, { props: { ...base, panels } });
		const f = fig(container)!;
		expect(f.getAttribute('data-mode')).toBe('cycle');
		// The DEFINING per-panel mean line renders once per panel; no degrade bars.
		expect(f.querySelectorAll('[data-slot="cycle-plot-mean"]').length).toBe(7);
		expect(f.querySelector('[data-slot="cycle-plot-bar"]')).toBeNull();
	});

	it('scales the bar on the FIXED domain — a value below the domain top never fills the panel', () => {
		// panelHeight default 72, PAD 8, innerH 56; domain [0,6]. A value of 3 (mid) →
		// y = 8 + (1 - 3/6)*56 = 36; bar height = (72 - 8) - 36 = 28 (half the inner span).
		const panels = frame((iso) => (iso === 1 ? { points: [3], observationCount: 40 } : {}));
		const { container } = render(CyclePlot, { props: { ...base, panels } });
		const bar = fig(container)!.querySelector('[data-slot="cycle-plot-bar"]')!;
		const y = Number(bar.getAttribute('y'));
		const h = Number(bar.getAttribute('height'));
		expect(y).toBeGreaterThan(35);
		expect(y).toBeLessThan(37);
		expect(h).toBeGreaterThan(27);
		expect(h).toBeLessThan(29);
	});

	it('shows the severe-delay second mark (glyph + severity-scale colour) when present, never colour-only', () => {
		const panels = frame((iso) =>
			iso === 1
				? { points: [2], severePct: 12, severity: 'critical', observationCount: 50 }
				: { points: [1], observationCount: 50 },
		);
		const { container } = render(CyclePlot, { props: { ...base, panels } });
		const f = fig(container)!;
		const severe = f.querySelector('[data-slot="cycle-plot-severe"]')!;
		expect(severe).not.toBeNull();
		// The mark carries a glyph (colour is never the sole channel) + the share value.
		expect(severe.textContent).toContain('◆');
		expect(severe.textContent).toContain('12');
		// The fill rides the dataviz severity scale, never --primary.
		const fill = severe.querySelector<HTMLElement>('.dv-cycleplot-severe-fill')!;
		expect(fill.getAttribute('style')).toContain('var(--dataviz-severity-critical)');
	});

	it('withholds the severe mark for a thin-sample weekday (the caller passes severePct=null) — never a fabricated number', () => {
		// Mirrors the consumer's n≥5 gate: a thin weekday arrives with severePct already nulled.
		const panels = frame((iso) =>
			iso === 1
				? { points: [2], severePct: null, observationCount: 2 }
				: { points: [1], observationCount: 40 },
		);
		const { container } = render(CyclePlot, { props: { ...base, panels } });
		const f = fig(container)!;
		// No severe mark anywhere (no other panel set one either).
		expect(f.querySelector('[data-slot="cycle-plot-severe"]')).toBeNull();
	});

	it('renders the observation count as a visible n=', () => {
		const panels = frame((iso) => (iso === 1 ? { points: [2], observationCount: 420 } : {}));
		const { container } = render(CyclePlot, { props: { ...base, panels } });
		const n = fig(container)!.querySelector('[data-slot="cycle-plot-n"]')!;
		expect(n.textContent).toContain('n=420');
	});

	it('annotates the steepest-trend panel in cycle mode (largest |last − first| run)', () => {
		const panels = frame((iso) =>
			iso === 3
				? { points: [1, 5], observationCount: 100 } // delta +4 → the steepest
				: { points: [2, 2.5], observationCount: 100 },
		);
		const { container } = render(CyclePlot, { props: { ...base, panels } });
		const ann = fig(container)!.querySelector('[data-slot="cycle-plot-steepest"]')!;
		expect(ann).not.toBeNull();
		expect(ann.textContent).toContain('Wednesday');
		expect(ann.textContent).toContain('+4');
	});

	it('routes an empty weekday through the honest-absence chip (says WHY), never a fabricated 0 panel', () => {
		const panels = frame((iso) => (iso === 7 ? {} : { points: [iso * 0.5], observationCount: 40 }));
		const { container } = render(CyclePlot, { props: { ...base, panels } });
		const f = fig(container)!;
		// Six weekdays drew a bar; the seventh (empty) routes through the chip.
		expect(f.querySelectorAll('[data-slot="cycle-plot-bar"]').length).toBe(6);
		const sun = f.querySelector('[data-day="Sun"]')!;
		expect(sun.querySelector('[data-slot="absent-value"]')).not.toBeNull();
	});

	it('routes a fully-absent figure through the honest-absence chip — never a 0 cycle plot', () => {
		const panels = frame(() => ({})); // every weekday empty
		const { container } = render(CyclePlot, { props: { ...base, panels } });
		expect(fig(container)).toBeNull();
		const absent = container.querySelector('[data-slot="absent-value"]');
		expect(absent).not.toBeNull();
		expect(absent?.getAttribute('data-tone')).toBe('unknown');
	});
});
