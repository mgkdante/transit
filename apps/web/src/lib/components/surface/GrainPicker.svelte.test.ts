import { render, fireEvent, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import GrainPicker from './GrainPicker.svelte';

type Grain = 'day' | 'week' | 'month' | 'shift';

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

const FOUR_SEGMENTS = [
	{ key: 'day', label: 'Day', available: true },
	{ key: 'week', label: 'Week', available: true },
	{ key: 'month', label: 'Month', available: true },
	{
		key: 'shift',
		label: 'Heures de pointe',
		compactLabel: 'Pointe',
		available: true,
	},
] as const;

const THREE_SEGMENTS = FOUR_SEGMENTS.slice(0, 3);
const TWO_SEGMENTS = FOUR_SEGMENTS.slice(0, 2);

function renderPicker(
	segments: readonly { key: Grain; label: string; available: boolean }[],
	value: Grain,
) {
	return render(GrainPicker, {
		props: { segments, value, label: 'Roll-up period' },
	});
}

describe('GrainPicker — variants', () => {
	it('renders the opt-in time grid as four row-major compact segments', () => {
		const { getByRole } = render(GrainPicker, {
			props: {
				segments: FOUR_SEGMENTS,
				value: 'day',
				label: 'Roll-up period',
				variant: 'time-grid',
			},
		});
		const group = getByRole('radiogroup', { name: 'Roll-up period' });
		expect(group).toHaveAttribute('data-variant', 'time-grid');
		expect(group).toHaveClass('segmented-choice--joined-grid');
		expect(group).toHaveAttribute('data-segment-count', '4');
		const radios = within(group).getAllByRole('radio');
		expect(radios.map((radio) => radio.textContent?.trim())).toEqual([
			'Day',
			'Week',
			'Month',
			'Pointe',
		]);
		const shift = within(group).getByRole('radio', { name: 'Heures de pointe' });
		expect(shift).toHaveTextContent('Pointe');
		expect(shift).toHaveAttribute('title', 'Heures de pointe');
	});

	it('adapts joined time grids for three and two real choices', () => {
		const three = render(GrainPicker, {
			props: {
				segments: THREE_SEGMENTS,
				value: 'day',
				label: 'Three choices',
				variant: 'time-grid',
			},
		});
		const threeGroup = three.getByRole('radiogroup', { name: 'Three choices' });
		expect(threeGroup).toHaveAttribute('data-segment-count', '3');
		expect(
			within(threeGroup)
				.getAllByRole('radio')
				.map((radio) => radio.textContent?.trim()),
		).toEqual(['Day', 'Week', 'Month']);

		const two = render(GrainPicker, {
			props: {
				segments: TWO_SEGMENTS,
				value: 'day',
				label: 'Two choices',
				variant: 'time-grid',
			},
		});
		const twoGroup = two.getByRole('radiogroup', { name: 'Two choices' });
		expect(twoGroup).toHaveAttribute('data-segment-count', '2');
		expect(
			within(twoGroup)
				.getAllByRole('radio')
				.map((radio) => radio.textContent?.trim()),
		).toEqual(['Day', 'Week']);
	});

	it('preserves the full French label in a disabled compact pointer hint', () => {
		const { getByRole } = render(GrainPicker, {
			props: {
				segments: [
					{ key: 'day', label: 'Jour', available: true },
					{
						key: 'shift',
						label: 'Heures de pointe',
						compactLabel: 'Pointe',
						available: false,
						title: 'Aucune observation',
					},
				],
				value: 'day',
				label: 'Période',
			},
		});
		const shift = getByRole('radio', { name: 'Heures de pointe' });
		expect(shift).toHaveTextContent('Pointe');
		expect(shift).toHaveAttribute('title', 'Heures de pointe: Aucune observation');
	});
});

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

		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'ArrowRight' });
		expect(getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true');

		await fireEvent.keyDown(checkedRadio(getByRole), { key: 'ArrowLeft' });
		expect(getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
	});

	it('skips a disabled segment when moving', async () => {
		const { getByRole } = renderPicker(MONTH_DISABLED, 'week');

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
