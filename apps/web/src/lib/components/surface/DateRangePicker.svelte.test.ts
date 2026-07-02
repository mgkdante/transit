// DateRangePicker.svelte.test.ts — the shared, availability-aware date-window control (S8B).
//
// Guards the primitive's contract: options are the surface's REAL dates ONLY (an
// out-of-coverage pick is impossible), any pick order normalizes to from<=to, a half
// pick emits NO window (undefined — never a fabricated/inverted span), empty coverage
// renders honest absence (not a dead control), the value binds in AND out, every label
// is a prop (the primitive owns no copy), and a11y AA (a labelled group, per-select
// aria-labels, 44px touch targets, native keyboard).

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
// external `value` update re-seeds the selects (the SurfaceControls bindable pattern).
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

describe('DateRangePicker — options + normalization', () => {
	it('offers ONLY the real available dates (out-of-coverage pick impossible)', () => {
		const { getByLabelText } = renderPicker();
		const start = getByLabelText('Pick a date range · From') as HTMLSelectElement;
		// The placeholder option + the three real dates — nothing else.
		const values = Array.from(start.options).map((o) => o.value);
		expect(values).toEqual(['', ...DATES]);
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
		// No selects at all — the honest-absence block stands in.
		expect(queryByLabelText('Pick a date range · From')).toBeNull();
		expect(container.querySelector('[data-slot="date-range"]')).toBeNull();
		expect(container.textContent).not.toBe('');
	});
});

describe('DateRangePicker — a11y AA', () => {
	it('wraps the pair in a labelled group and labels each select', () => {
		const { getByRole } = renderPicker();
		const group = getByRole('group', { name: 'Pick a date range' });
		expect(within(group).getByLabelText('Pick a date range · From')).toBeInTheDocument();
		expect(within(group).getByLabelText('Pick a date range · To')).toBeInTheDocument();
	});

	it('gives each native select a 44px minimum touch target (WCAG 2.2 AA)', () => {
		const { getByLabelText } = renderPicker();
		const start = getByLabelText('Pick a date range · From') as HTMLSelectElement;
		// The 44px floor is declared on the .date-range__select class (jsdom carries no
		// layout, so assert the class the min-height rule targets is present).
		expect(start.classList.contains('date-range__select')).toBe(true);
	});
});
