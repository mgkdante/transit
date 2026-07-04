// DateRangePicker.svelte.test.ts — the shared, availability-aware date-window control (S8B).
//
// Guards the primitive's contract: the native calendar pickers (<input type="date">) are
// BOUNDED (min/max) to the surface's REAL dated span (an out-of-coverage pick is scoped
// out by the OS calendar), any pick order normalizes to from<=to, a half pick emits NO
// window (undefined — never a fabricated/inverted span), empty coverage renders honest
// absence (not a dead control), the value binds in AND out, every label is a prop (the
// primitive owns no copy), and a11y AA (a labelled group, per-input aria-labels, 44px
// touch targets, native keyboard + OS calendar).

import { render, fireEvent, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DateRangePicker from './DateRangePicker.svelte';
import type { DateWindow } from '$lib/filters';

const DATES = ['2026-06-01', '2026-06-02', '2026-06-03'] as const;
const LABELS = {
	group: 'Pick a date range',
	start: 'From',
	end: 'To',
	clear: 'Full window',
	anyStart: 'Earliest',
	anyEnd: 'Latest',
} as const;

// A get/set-bound harness so a change to the primitive's `value` is observable and an
// external `value` update re-seeds the inputs (the SurfaceControls bindable pattern).
function renderPicker(
	initial: DateWindow | undefined = undefined,
	overrides: Record<string, unknown> = {},
) {
	const box = { value: initial };
	const result = render(DateRangePicker, {
		props: {
			availableDates: DATES,
			locale: 'en' as const,
			labels: LABELS,
			get value() {
				return box.value;
			},
			set value(v: DateWindow | undefined) {
				box.value = v;
			},
			...overrides,
		},
	});
	return { ...result, box };
}

describe('DateRangePicker — bounds + normalization', () => {
	it('bounds the native calendar to the surface real span (out-of-coverage pick scoped out)', () => {
		const { getByLabelText } = renderPicker();
		const start = getByLabelText('Pick a date range · From') as HTMLInputElement;
		const end = getByLabelText('Pick a date range · To') as HTMLInputElement;
		// Native date pickers, min/max clamped to the first + last real dated day.
		expect(start.type).toBe('date');
		expect(end.type).toBe('date');
		expect(start.min).toBe('2026-06-01');
		expect(start.max).toBe('2026-06-03');
		expect(end.min).toBe('2026-06-01');
		expect(end.max).toBe('2026-06-03');
	});

	it('composes a complete window (start then end) with from<=to', async () => {
		const { getByLabelText, box } = renderPicker();
		await fireEvent.change(getByLabelText('Pick a date range · From'), {
			target: { value: '2026-06-01' },
		});
		// Half pick: only start chosen → NO window yet (never a fabricated span).
		expect(box.value).toBeUndefined();
		await fireEvent.change(getByLabelText('Pick a date range · To'), {
			target: { value: '2026-06-03' },
		});
		expect(box.value).toEqual({ from: '2026-06-01', to: '2026-06-03' });
	});

	it('normalizes an INVERTED pick order (to < from is swapped)', async () => {
		const { getByLabelText, box } = renderPicker();
		// Pick the END first (earlier date), then the START (later date) — inverted.
		await fireEvent.change(getByLabelText('Pick a date range · To'), {
			target: { value: '2026-06-01' },
		});
		await fireEvent.change(getByLabelText('Pick a date range · From'), {
			target: { value: '2026-06-03' },
		});
		// normalizeWindow swaps so the stored span always reads from<=to.
		expect(box.value).toEqual({ from: '2026-06-01', to: '2026-06-03' });
	});

	it('clearing a bound loses the window (half pick emits undefined, never a partial span)', async () => {
		const { getByLabelText, box } = renderPicker({ from: '2026-06-01', to: '2026-06-03' });
		await fireEvent.change(getByLabelText('Pick a date range · To'), { target: { value: '' } });
		expect(box.value).toBeUndefined();
	});
});

describe('DateRangePicker — clear affordance', () => {
	it('shows Clear only when a window is set, and clearing resets to undefined', async () => {
		const { getByText, box } = renderPicker({ from: '2026-06-01', to: '2026-06-02' });
		const clear = getByText('Full window');
		expect(clear).toBeInTheDocument();
		await fireEvent.click(clear);
		expect(box.value).toBeUndefined();
	});

	it('hides Clear entirely with clearable=false (lines: the grain owns range mode)', () => {
		const { queryByText } = renderPicker(
			{ from: '2026-06-01', to: '2026-06-02' },
			{
				clearable: false,
			},
		);
		expect(queryByText('Full window')).toBeNull();
	});
});

describe('DateRangePicker — honest absence', () => {
	it('renders an AbsentValue (not a dead control) when there are no available dates', () => {
		const { container, queryByLabelText } = renderPicker(undefined, { availableDates: [] });
		// No inputs at all — the honest-absence block stands in.
		expect(queryByLabelText('Pick a date range · From')).toBeNull();
		expect(container.querySelector('[data-slot="date-range"]')).toBeNull();
		expect(container.textContent).not.toBe('');
	});
});

describe('DateRangePicker — single mode (S13 receipt)', () => {
	const OPTIONS = [
		{ date: '2026-06-01', label: 'Jun 1', disabled: false },
		{ date: '2026-06-02', label: 'Jun 2', disabled: true, disabledLabel: 'no receipt' },
		{ date: '2026-06-03', label: 'Jun 3', disabled: false },
	] as const;

	function renderSingle(initial: string | undefined = undefined) {
		const box = { date: initial as string | undefined };
		const result = render(DateRangePicker, {
			props: {
				mode: 'single' as const,
				dateOptions: OPTIONS,
				locale: 'en' as const,
				labels: { ...LABELS, single: 'Receipt day' },
				get date() {
					return box.date;
				},
				set date(v: string | undefined) {
					box.date = v;
				},
			},
		});
		return { ...result, box };
	}

	it('bounds the calendar to the published span (earliest→latest, seeded value reflected)', () => {
		const { getByLabelText } = renderSingle('2026-06-03');
		const input = getByLabelText('Receipt day') as HTMLInputElement;
		// A native date picker bounded to the calendar span. Degradation from the old
		// <select>: an interior gap-day (2026-06-02) is now pickable (native calendars can't
		// DISABLE an interior day) and resolves HONESTLY through the receipt's absent-day path.
		expect(input.type).toBe('date');
		expect(input.min).toBe('2026-06-01');
		expect(input.max).toBe('2026-06-03');
		expect(input.value).toBe('2026-06-03');
	});

	it('binds the single date OUT on change (a published day)', async () => {
		const { getByLabelText, box } = renderSingle('2026-06-03');
		await fireEvent.change(getByLabelText('Receipt day'), { target: { value: '2026-06-01' } });
		expect(box.date).toBe('2026-06-01');
	});

	it('renders honest absence (no input) when the calendar is empty', () => {
		const { container, queryByLabelText } = render(DateRangePicker, {
			props: {
				mode: 'single' as const,
				dateOptions: [],
				locale: 'en' as const,
				labels: { ...LABELS, single: 'Receipt day' },
			},
		});
		expect(queryByLabelText('Receipt day')).toBeNull();
		expect(container.querySelector('[data-slot="single-date"]')).toBeNull();
		expect(container.textContent).not.toBe('');
	});

	it('leaves the RANGE mode untouched (default mode renders the from/to pair)', () => {
		const { getByLabelText, queryByLabelText } = renderPicker();
		expect(getByLabelText('Pick a date range · From')).toBeInTheDocument();
		expect(getByLabelText('Pick a date range · To')).toBeInTheDocument();
		expect(queryByLabelText('Receipt day')).toBeNull();
	});
});

describe('DateRangePicker — a11y AA', () => {
	it('wraps the pair in a labelled group and labels each input', () => {
		const { getByRole } = renderPicker();
		const group = getByRole('group', { name: 'Pick a date range' });
		expect(within(group).getByLabelText('Pick a date range · From')).toBeInTheDocument();
		expect(within(group).getByLabelText('Pick a date range · To')).toBeInTheDocument();
	});

	it('gives each native date input a 44px minimum touch target (WCAG 2.2 AA)', () => {
		const { getByLabelText } = renderPicker();
		const start = getByLabelText('Pick a date range · From') as HTMLInputElement;
		// The 44px floor is declared on the .date-range__input class (jsdom carries no
		// layout, so assert the class the min-height rule targets is present).
		expect(start.classList.contains('date-range__input')).toBe(true);
	});
});
