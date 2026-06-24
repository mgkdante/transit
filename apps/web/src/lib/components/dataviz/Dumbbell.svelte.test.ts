// Dumbbell.svelte.test.ts — locks the P8 scheduled-vs-observed headway dumbbell
// contract: two value ticks (scheduled / observed) render on the FIXED passed domain,
// the connecting span (excess wait) draws only when BOTH endpoints resolve, both ticks
// carry a glyph + dataviz-scale colour + aria (direction never colour-only), the excess
// annotation is honest (omitted when absent, never a fabricated 0), and a fully-absent
// figure routes through the honest-absence chip.

import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Dumbbell from './Dumbbell.svelte';

const DOMAIN = [0, 35] as const;

const base = {
	scheduledMin: 6,
	observedMin: 8.4,
	excessMin: 2.4,
	domain: DOMAIN,
	scheduledLabel: 'Scheduled gap',
	observedLabel: 'Observed gap',
	excessLabel: (v: string) => `Excess wait ${v}`,
	ariaLabel: (s: string, o: string) => `Scheduled gap ${s} min, observed gap ${o} min`,
	locale: 'en' as const,
	noDataLabel: 'no data',
};

const fig = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="dumbbell"]');

describe('Dumbbell — scheduled-vs-observed headway dumbbell on a fixed domain', () => {
	it('renders the figure, both endpoint dots, and the excess-wait span', () => {
		const { container } = render(Dumbbell, { props: { ...base } });
		const f = fig(container);
		expect(f).not.toBeNull();
		// Both endpoint dots ride the dataviz scale (never --primary).
		const sched = f!.querySelector('circle[data-end="scheduled"]');
		const obs = f!.querySelector('circle[data-end="observed"]');
		expect(sched?.getAttribute('fill')).toBe('var(--dataviz-status-early)');
		expect(obs?.getAttribute('fill')).toBe('var(--dataviz-status-late)');
		// The span draws on the amber (observed/excess) token.
		const span = f!.querySelector('[data-slot="dumbbell-span"]');
		expect(span?.getAttribute('stroke')).toBe('var(--dataviz-status-late)');
		// The whole-figure summary names both readings.
		expect(f!.querySelector('svg')?.getAttribute('aria-label')).toContain('6');
		expect(f!.querySelector('svg')?.getAttribute('aria-label')).toContain('8.4');
	});

	it('scales each tick on the FIXED domain — the same value lands at the same x', () => {
		const { container } = render(Dumbbell, { props: { ...base } });
		const f = fig(container)!;
		// width 320, PAD 8, innerW 304; domain [0,35]. scheduled 6 → 8 + (6/35)*304 ≈ 60.1.
		const schedDot = f.querySelector('circle[data-end="scheduled"]')!;
		const cx = Number(schedDot.getAttribute('cx'));
		expect(cx).toBeGreaterThan(59);
		expect(cx).toBeLessThan(61);
	});

	it('shows the excess-wait annotation with the metric-value (yellow) token', () => {
		const { container } = render(Dumbbell, { props: { ...base } });
		const excess = fig(container)!.querySelector('[data-slot="dumbbell-excess"]') as HTMLElement;
		expect(excess).not.toBeNull();
		expect(excess.textContent).toContain('2.4');
	});

	it('omits the span (and the excess annotation) when only one endpoint resolves — no fake 0', () => {
		const { container } = render(Dumbbell, {
			props: { ...base, observedMin: null, excessMin: null },
		});
		const f = fig(container)!;
		expect(f.querySelector('circle[data-end="scheduled"]')).not.toBeNull();
		expect(f.querySelector('circle[data-end="observed"]')).toBeNull();
		expect(f.querySelector('[data-slot="dumbbell-span"]')).toBeNull();
		expect(f.querySelector('[data-slot="dumbbell-excess"]')).toBeNull();
		// The absent observed value reads the honest no-data label, never a fabricated 0.
		expect(f.textContent).toContain('no data');
	});

	it('routes a fully-absent figure through the honest-absence chip (says WHY), never a 0 dumbbell', () => {
		const { container } = render(Dumbbell, {
			props: { ...base, scheduledMin: null, observedMin: null, excessMin: null },
		});
		expect(fig(container)).toBeNull();
		const absent = container.querySelector('[data-slot="absent-value"]');
		expect(absent).not.toBeNull();
		expect(absent?.getAttribute('data-tone')).toBe('unknown');
	});

	describe('opt-in interactive hover/focus affordance', () => {
		it('renders NO focus targets by default (interactive off → byte-identical)', () => {
			const { container } = render(Dumbbell, { props: { ...base } });
			const f = fig(container)!;
			expect(f.querySelectorAll('[data-hit]').length).toBe(0);
			// The SVG keeps its own aria-label and is not aria-hidden when non-interactive.
			const svg = f.querySelector('svg')!;
			expect(svg.getAttribute('aria-hidden')).toBeNull();
		});

		it('exposes a focusable, aria-labelled target for each present mark when interactive', () => {
			const { container } = render(Dumbbell, { props: { ...base, interactive: true } });
			const f = fig(container)!;
			const sched = f.querySelector<HTMLElement>('[data-hit="scheduled"]')!;
			const obs = f.querySelector<HTMLElement>('[data-hit="observed"]')!;
			const span = f.querySelector<HTMLElement>('[data-hit="span"]')!;
			// All three marks are keyboard-reachable.
			expect(sched.getAttribute('tabindex')).toBe('0');
			expect(obs.getAttribute('tabindex')).toBe('0');
			expect(span.getAttribute('tabindex')).toBe('0');
			// Each carries a full aria-label so colour/position is never the sole channel.
			expect(sched.getAttribute('aria-label')).toContain('Scheduled gap');
			expect(sched.getAttribute('aria-label')).toContain('6');
			expect(obs.getAttribute('aria-label')).toContain('Observed gap');
			expect(obs.getAttribute('aria-label')).toContain('8.4');
			expect(span.getAttribute('aria-label')).toContain('Excess wait');
			expect(span.getAttribute('aria-label')).toContain('2.4');
			// The decorative SVG defers its label to the hit targets.
			expect(f.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
		});

		it('omits the span hit target (no tooltip on an absent span) when only one endpoint resolves', () => {
			const { container } = render(Dumbbell, {
				props: { ...base, interactive: true, observedMin: null, excessMin: null },
			});
			const f = fig(container)!;
			expect(f.querySelector('[data-hit="scheduled"]')).not.toBeNull();
			expect(f.querySelector('[data-hit="observed"]')).toBeNull();
			expect(f.querySelector('[data-hit="span"]')).toBeNull();
		});
	});
});
