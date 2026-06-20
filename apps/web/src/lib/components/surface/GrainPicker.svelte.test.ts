// GrainPicker.svelte.test.ts — DOM gate for the day|week|month segmented control.
//
// Guards the WAI-ARIA radiogroup contract: aria-checked semantics, disabled
// segments are never selectable, roving tabindex (only the checked segment is
// tab-focusable), and the arrow-key keyboard pattern (next/previous ENABLED
// segment, wrapping, skipping disabled).

import { render, fireEvent, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import GrainPicker from './GrainPicker.svelte';

type Grain = 'day' | 'week' | 'month';

const ALL_ENABLED = [
	{ key: 'day', label: 'Day', available: true },
	{ key: 'week', label: 'Week', available: true },
	{ key: 'month', label: 'Month', available: true },
] as const;

const MONTH_DISABLED = [
	{ key: 'day', label: 'Day', available: true },
	{ key: 'week', label: 'Week', available: true },
	{ key: 'month', label: 'Month', available: false },
] as const;

function renderPicker(
	segments: readonly { key: Grain; label: string; available: boolean }[],
	value: Grain,
) {
	return render(GrainPicker, {
		props: { segments, value, label: 'Roll-up period' },
	});
}

describe('GrainPicker — radiogroup semantics', () => {
	it('marks the bound value as the checked radio', () => {
		const { getByRole } = renderPicker(ALL_ENABLED, 'week');
		const group = getByRole('radiogroup', { name: 'Roll-up period' });
		expect(within(group).getByRole('radio', { name: 'Week' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
		expect(within(group).getByRole('radio', { name: 'Day' })).toHaveAttribute(
			'aria-checked',
			'false',
		);
	});

	it('disables an unavailable segment so it is never selectable', () => {
		const { getByRole } = renderPicker(MONTH_DISABLED, 'day');
		const month = getByRole('radio', { name: 'Month' });
		expect(month).toBeDisabled();
	});
});

describe('GrainPicker — roving tabindex', () => {
	it('puts tabindex=0 only on the checked segment, -1 on the rest', () => {
		const { getByRole } = renderPicker(ALL_ENABLED, 'week');
		expect(getByRole('radio', { name: 'Day' })).toHaveAttribute('tabindex', '-1');
		expect(getByRole('radio', { name: 'Week' })).toHaveAttribute('tabindex', '0');
		expect(getByRole('radio', { name: 'Month' })).toHaveAttribute('tabindex', '-1');
	});
});

/** The currently-checked radio (the roving-tabindex focus anchor) — keydown fires here. */
function checkedRadio(getByRole: (role: string, opts?: object) => HTMLElement): HTMLElement {
	const group = getByRole('radiogroup', { name: 'Roll-up period' });
	const radios = within(group).getAllByRole('radio');
	return radios.find((r) => r.getAttribute('aria-checked') === 'true') ?? radios[0];
}

describe('GrainPicker — arrow-key keyboard pattern', () => {
	it('ArrowRight/ArrowDown move selection to the next enabled segment', async () => {
		const { getByRole } = renderPicker(ALL_ENABLED, 'day');

		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'ArrowRight' });
		expect(getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');

		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'ArrowDown' });
		expect(getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
	});

	it('ArrowLeft/ArrowUp move selection to the previous enabled segment', async () => {
		const { getByRole } = renderPicker(ALL_ENABLED, 'month');

		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'ArrowLeft' });
		expect(getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');

		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'ArrowUp' });
		expect(getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
	});

	it('wraps around at the ends', async () => {
		const { getByRole } = renderPicker(ALL_ENABLED, 'month');

		// month → (wrap) → day
		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'ArrowRight' });
		expect(getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');

		// day → (wrap) → month
		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'ArrowLeft' });
		expect(getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
	});

	it('skips a disabled segment when moving', async () => {
		const { getByRole } = renderPicker(MONTH_DISABLED, 'week');

		// week → ArrowRight would land on month (disabled) → wraps past it to day.
		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'ArrowRight' });
		expect(getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
		expect(getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'false');
	});

	it('ignores non-arrow keys', async () => {
		const { getByRole } = renderPicker(ALL_ENABLED, 'day');

		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'Enter' });
		expect(getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');
	});
});
