import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { DelayLabelCopy } from '$lib/site/delayPresentation';
import ScheduleTable, { type ScheduleRow } from './ScheduleTable.svelte';

// The plain-language delay copy (mirrors StopDetail's t.next): no `noDelay`, so an
// absent delay falls back to `onTime` — the scheduled-board semantics.
const DELAY_COPY: DelayLabelCopy = {
	early: (m) => `${Math.abs(m)} min early`,
	late: (m) => `+${m} min late`,
	onTime: 'on time',
};

describe('ScheduleTable — grid mode', () => {
	it('renders a 5-column column-major grid with the explicit row count (ceil(n/columns))', () => {
		const rows: ScheduleRow[] = [
			{
				kind: 'grid',
				route: '51',
				headsign: 'Nord',
				times: ['08:00', '08:10', '08:20', '08:30', '08:40', '08:50'],
			},
		];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'grid', locale: 'en', moreLabel: (n) => `+${n} more times` },
		});
		const grid = container.querySelector('.stop-schedule-times') as HTMLElement;
		expect(grid).not.toBeNull();
		// 6 times over 5 columns → ceil(6/5) = 2 rows (column-major vertical fill).
		const style = (grid.getAttribute('style') ?? '').replace(/\s/g, '');
		expect(style).toContain('--sched-rows:2');
		// The column count is wired to the CSS too (default 5), so the `columns` prop is
		// fully honored — not just the row math.
		expect(style).toContain('--sched-cols:5');
		// The route header renders code + headsign.
		expect(screen.getByText('51')).toBeInTheDocument();
		expect(screen.getByText('Nord')).toBeInTheDocument();
	});

	it('honors a custom `columns` value in BOTH the row math and the CSS column count', () => {
		const rows: ScheduleRow[] = [
			{ kind: 'grid', route: '51', times: ['08:00', '08:10', '08:20', '08:30', '08:40', '08:50'] },
		];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'grid', locale: 'en', columns: 3 },
		});
		const grid = container.querySelector('.stop-schedule-times') as HTMLElement;
		const style = (grid.getAttribute('style') ?? '').replace(/\s/g, '');
		// 6 times over 3 columns → ceil(6/3) = 2 rows, and the CSS renders 3 columns.
		expect(style).toContain('--sched-cols:3');
		expect(style).toContain('--sched-rows:2');
	});

	it('caps the shown times and prints the honest "+N more" overflow note via moreLabel', () => {
		// 32 times, cap 30 → 30 shown + a "+2 more times" note.
		const times = Array.from({ length: 32 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
		const rows: ScheduleRow[] = [{ kind: 'grid', route: '80', times }];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'grid', locale: 'en', cap: 30, moreLabel: (n) => `+${n} more times` },
		});
		// Exactly 30 time cells rendered (the cap), not all 32.
		expect(container.querySelectorAll('.stop-schedule-time').length).toBe(30);
		// The remainder is carried by the honest note.
		expect(screen.getByText('+2 more times')).toBeInTheDocument();
	});

	it('states an honest per-route AbsentValue when a listed route has NO times', () => {
		const rows: ScheduleRow[] = [{ kind: 'grid', route: '99', headsign: 'Vide', times: [] }];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'grid', locale: 'en' },
		});
		// No silently-empty grid…
		expect(container.querySelector('.stop-schedule-times')).toBeNull();
		// …the route header still renders, and its times block is the honest AbsentValue chip.
		expect(screen.getByText('99')).toBeInTheDocument();
		const chip = document.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain('not enough readings yet');
	});
});

describe('ScheduleTable — board mode', () => {
	it('tints each departure caption with the shared status fill AND a redundant glyph', () => {
		const rows: ScheduleRow[] = [
			{ kind: 'board', route: '51', eta_utc: '2026-06-15T12:05:00Z', delay_min: 4 }, // late
		];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'board', locale: 'en', delayCopy: DELAY_COPY, routeFallback: 'Line' },
		});
		const late = container.querySelector('.stop-departure-delay') as HTMLElement;
		expect(late).not.toBeNull();
		expect(late.getAttribute('data-tone')).toBe('late');
		expect(late.getAttribute('style') ?? '').toContain('--dataviz-status-late');
		// Redundant glyph (▲ = behind schedule) + the plain-language delay label.
		expect(late.querySelector('.stop-departure-glyph')?.textContent).toBe('▲');
		expect(late.textContent).toContain('+4 min late');
	});

	it('bands a >=5 min departure to the SEVERE tone (its own severe fill)', () => {
		const rows: ScheduleRow[] = [
			{ kind: 'board', route: '51', eta_utc: '2026-06-15T12:05:00Z', delay_min: 9 },
		];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'board', locale: 'en', delayCopy: DELAY_COPY },
		});
		const severe = container.querySelector('.stop-departure-delay') as HTMLElement;
		expect(severe.getAttribute('data-tone')).toBe('severe');
		expect(severe.getAttribute('style') ?? '').toContain('--dataviz-status-severe');
	});

	it('rides the muted no-data track for a null delay (no fill, no glyph, falls back to on time)', () => {
		const rows: ScheduleRow[] = [
			{ kind: 'board', route: '80', eta_utc: '2026-06-15T12:08:00Z', delay_min: null },
		];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'board', locale: 'en', delayCopy: DELAY_COPY },
		});
		const none = container.querySelector('.stop-departure-delay') as HTMLElement;
		expect(none.getAttribute('data-tone')).toBe('none');
		// No status fill and no glyph — absence never reads as an on-time claim by colour.
		expect(none.getAttribute('style') ?? '').not.toContain('--dataviz-status');
		expect(none.querySelector('.stop-departure-glyph')).toBeNull();
		// The plain-language reading falls back to "on time" (no noDelay copy supplied).
		expect(none.textContent).toContain('on time');
	});

	it('renders the route fallback label when a departure has no route code', () => {
		const rows: ScheduleRow[] = [{ kind: 'board', eta_utc: '2026-06-15T12:08:00Z', delay_min: 0 }];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'board', locale: 'en', delayCopy: DELAY_COPY, routeFallback: 'Line' },
		});
		const route = container.querySelector('.stop-departure-route') as HTMLElement;
		expect(route.textContent).toBe('Line');
	});
});
