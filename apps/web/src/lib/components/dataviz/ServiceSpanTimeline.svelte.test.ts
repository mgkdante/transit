// ServiceSpanTimeline.svelte.test.ts — locks the P3 service-span timeline contract:
// the first→last bar renders on a FIXED 24h axis with America/Toronto clock endpoints,
// the signed first/last-trip punctuality markers are glyph + dataviz-scale colour + aria
// (direction never colour-only), the span/trip annotations are honest (omitted when
// absent, never a fabricated 0), and a null span routes through the honest-absence chip.
//
// Clock formatting is timezone-pinned to America/Toronto inside the component, so the
// expected wall-clock strings are stable regardless of the test runner's TZ.

import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ServiceSpanTimeline from './ServiceSpanTimeline.svelte';

const fig = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="service-span-timeline"]');
const delayEl = (c: HTMLElement, end: 'first' | 'last') =>
	c.querySelector<HTMLElement>(`[data-slot="span-delay"][data-end="${end}"]`)!;

const base = {
	// 2026-06-15 is EDT (UTC-4): 10:05Z → 06:05 local, next-day 01:50Z → 21:50 local.
	firstTripUtc: '2026-06-15T10:05:00Z',
	lastTripUtc: '2026-06-16T01:50:00Z',
	firstDelayMin: -1.2,
	lastDelayMin: 3.4,
	spanLabel: 'Span 15h 45m',
	tripsLabel: '142 trips',
	firstLabel: 'First trip',
	lastLabel: 'Last trip',
	firstDelayLabel: 'First-trip delay',
	lastDelayLabel: 'Last-trip delay',
	ariaLabel: (f: string, l: string) =>
		`Service span, from the first trip at ${f} to the last at ${l}`,
	locale: 'en' as const,
};

describe('ServiceSpanTimeline — first→last service-span timeline on a fixed 24h axis', () => {
	it('renders the figure, the span bar, the two wall-clock endpoints, and the annotations', () => {
		const { container } = render(ServiceSpanTimeline, { props: { ...base } });
		const f = fig(container);
		expect(f).not.toBeNull();
		// The span bar rides the dataviz scale (never --primary).
		const bar = f!.querySelector('rect');
		expect(bar?.getAttribute('fill')).toBe('var(--dataviz-status-on-time)');
		// America/Toronto wall-clock endpoints (timezone-pinned in the component).
		expect(f!.textContent).toContain('06:05');
		expect(f!.textContent).toContain('21:50');
		// Honest annotations.
		expect(f!.querySelector('[data-slot="span-length"]')?.textContent).toBe('Span 15h 45m');
		expect(f!.querySelector('[data-slot="span-trips"]')?.textContent).toBe('142 trips');
		// The whole-figure summary names both clock times.
		expect(f!.querySelector('svg')?.getAttribute('aria-label')).toContain('06:05');
		expect(f!.querySelector('svg')?.getAttribute('aria-label')).toContain('21:50');
	});

	it('an EARLY first-trip delay is ▼ on the on-time token; aria carries the signed value', () => {
		const { container } = render(ServiceSpanTimeline, { props: { ...base } });
		const d = delayEl(container, 'first');
		expect(d.querySelector('.dv-span-delay-glyph')?.textContent).toContain('▼');
		expect(d.querySelector('.dv-span-delay-glyph')?.getAttribute('style')).toContain(
			'var(--dataviz-status-on-time)',
		);
		expect(d.getAttribute('aria-label')).toBe('First-trip delay: -1.2 min');
	});

	it('a LATE last-trip delay is ▲ on the late token; aria carries the +signed value', () => {
		const { container } = render(ServiceSpanTimeline, { props: { ...base } });
		const d = delayEl(container, 'last');
		expect(d.querySelector('.dv-span-delay-glyph')?.textContent).toContain('▲');
		expect(d.querySelector('.dv-span-delay-glyph')?.getAttribute('style')).toContain(
			'var(--dataviz-status-late)',
		);
		expect(d.getAttribute('aria-label')).toBe('Last-trip delay: +3.4 min');
	});

	it('a null delay is honest: neutral · glyph, no value text, "no data" aria — never a fake 0', () => {
		const { container } = render(ServiceSpanTimeline, {
			props: { ...base, firstDelayMin: null },
		});
		const d = delayEl(container, 'first');
		expect(d.querySelector('.dv-span-delay-glyph')?.textContent).toContain('·');
		expect(d.querySelector('.dv-span-delay-text')?.textContent).toBe('');
		expect(d.getAttribute('aria-label')).toBe('First-trip delay: no data');
	});

	it('omits an absent annotation rather than fabricating it', () => {
		const { container } = render(ServiceSpanTimeline, {
			props: { ...base, tripsLabel: null },
		});
		const f = fig(container);
		expect(f!.querySelector('[data-slot="span-length"]')).not.toBeNull();
		expect(f!.querySelector('[data-slot="span-trips"]')).toBeNull();
	});

	it('a null span routes through the honest-absence chip (says WHY), never a 0 bar', () => {
		const { container } = render(ServiceSpanTimeline, {
			props: { ...base, firstTripUtc: null, lastTripUtc: null },
		});
		expect(fig(container)).toBeNull();
		const absent = container.querySelector('[data-slot="absent-value"]');
		expect(absent).not.toBeNull();
		expect(absent?.getAttribute('data-tone')).toBe('unknown');
	});

	it('ALWAYS labels the fixed 24h frame: 00h / 06h / 12h / 18h / 24h hour ticks (interactive off)', () => {
		const { container } = render(ServiceSpanTimeline, { props: { ...base } });
		const hours = Array.from(container.querySelectorAll('.dv-span-hour')).map(
			(el) => el.textContent,
		);
		expect(hours).toEqual(['00h', '06h', '12h', '18h', '24h']);
	});

	it('interactive OFF (default): no focusable span-bar / delay hover targets exist', () => {
		const { container } = render(ServiceSpanTimeline, { props: { ...base } });
		// No transparent span-bar hit target.
		expect(container.querySelector('[data-slot="span-bar-hit"]')).toBeNull();
		// The delay pips are not focus targets.
		const first = delayEl(container, 'first');
		expect(first.getAttribute('tabindex')).toBeNull();
		expect(first.getAttribute('role')).toBeNull();
	});

	it('interactive ON: the span bar is a keyboard-reachable, aria-labelled hover target', () => {
		const { container } = render(ServiceSpanTimeline, {
			props: { ...base, interactive: true },
		});
		const hit = container.querySelector('[data-slot="span-bar-hit"]');
		expect(hit).not.toBeNull();
		expect(hit?.getAttribute('tabindex')).toBe('0');
		// Carries the whole-figure summary (both clocks) so it is not colour/position-only.
		expect(hit?.getAttribute('aria-label')).toContain('06:05');
		expect(hit?.getAttribute('aria-label')).toContain('21:50');
	});

	it('interactive ON: each delay pip is focusable and keeps its signed aria-label', () => {
		const { container } = render(ServiceSpanTimeline, {
			props: { ...base, interactive: true },
		});
		const first = delayEl(container, 'first');
		const last = delayEl(container, 'last');
		expect(first.getAttribute('tabindex')).toBe('0');
		expect(first.getAttribute('aria-label')).toBe('First-trip delay: -1.2 min');
		expect(last.getAttribute('tabindex')).toBe('0');
		expect(last.getAttribute('aria-label')).toBe('Last-trip delay: +3.4 min');
	});

	it('interactive ON: an absent delay pip is NOT a focus target (honest, no tooltip on no-data)', () => {
		const { container } = render(ServiceSpanTimeline, {
			props: { ...base, interactive: true, firstDelayMin: null },
		});
		const first = delayEl(container, 'first');
		expect(first.getAttribute('tabindex')).toBeNull();
		expect(first.getAttribute('aria-label')).toBe('First-trip delay: no data');
	});
});
