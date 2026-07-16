// GrainPicker.svelte.test.ts — DOM gate for the day|week|month segmented control.
//
// Guards the WAI-ARIA radiogroup contract: aria-checked semantics, disabled
// segments are never selectable, roving tabindex (only the checked segment is
// tab-focusable), and the arrow-key keyboard pattern (next/previous ENABLED
// segment, wrapping, skipping disabled).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const grainPickerPath = resolve(process.cwd(), 'src/lib/components/surface/GrainPicker.svelte');
const segmentedChoicePath = resolve(
	process.cwd(),
	'src/lib/components/surface/SegmentedChoice.svelte',
);
const grainPickerSource = readFileSync(grainPickerPath, 'utf-8');

function segmentedChoiceSource(): string {
	return existsSync(segmentedChoicePath) ? readFileSync(segmentedChoicePath, 'utf-8') : '';
}

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
		expect(radios.map((radio) => radio.getAttribute('data-grid-cell'))).toEqual([
			'1:1',
			'1:2',
			'2:1',
			'2:2',
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
				.map((radio) => radio.getAttribute('data-grid-cell')),
		).toEqual(['1:1', '1:2', '2:1-2']);

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
				.map((radio) => radio.getAttribute('data-grid-cell')),
		).toEqual(['1:1', '1:2']);
	});

	it('delegates the radio and visual engine to the shared segmented choice primitive', () => {
		const sharedSource = segmentedChoiceSource();
		expect(existsSync(segmentedChoicePath)).toBe(true);
		expect(grainPickerSource).toContain("import SegmentedChoice from './SegmentedChoice.svelte'");
		expect(grainPickerSource).not.toContain('function onkeydown');
		expect(sharedSource).toContain('role="radiogroup"');
		expect(sharedSource).toContain('role="radio"');
		expect(sharedSource).toContain('aria-checked');
		expect(sharedSource).toContain('tabindex');
		expect(sharedSource).toContain('function onkeydown');
	});

	it('owns one joined frame, internal dividers, exterior rounding, and 44px targets', () => {
		const sharedSource = segmentedChoiceSource();
		const rootModifier =
			sharedSource.match(/\.segmented-choice--joined-grid\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		const segmentModifier =
			sharedSource.match(
				/\.segmented-choice--joined-grid \.segmented-choice-segment\s*\{([\s\S]*?)\}/,
			)?.[1] ?? '';
		const baseSegment =
			sharedSource.match(/\n\t\.segmented-choice-segment\s*\{([\s\S]*?)\}/)?.[1] ?? '';

		expect(rootModifier).toContain('width: 100%');
		expect(rootModifier).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
		expect(rootModifier).toContain('gap: 0');
		expect(rootModifier).toContain('padding: 0');
		expect(rootModifier).toContain('overflow: hidden');
		expect(rootModifier).toContain('border: 1px solid var(--border)');
		expect(rootModifier).toContain('border-radius: var(--radius-lg)');

		expect(segmentModifier).toContain('width: 100%');
		expect(segmentModifier).toContain('min-width: 0');
		expect(segmentModifier).toContain('min-height: 52px');
		expect(segmentModifier).toContain('border: 0');
		expect(segmentModifier).toContain('border-radius: 0');
		expect(baseSegment).toContain('min-height: 44px');
		expect(baseSegment).toContain('align-items: center');
		expect(baseSegment).toContain('justify-content: center');
		expect(sharedSource).toContain(
			'.segmented-choice--joined-grid .segmented-choice-segment:nth-child(even)',
		);
		expect(sharedSource).toContain(
			'.segmented-choice--joined-grid .segmented-choice-segment:nth-child(n + 3)',
		);
		expect(sharedSource).toContain("[data-segment-count='3']");
	});

	it('neutralizes per-cell scale motion only inside the joined time grid', () => {
		const sharedSource = segmentedChoiceSource();
		const segmentModifier =
			sharedSource.match(
				/\.segmented-choice--joined-grid \.segmented-choice-segment\s*\{([\s\S]*?)\}/,
			)?.[1] ?? '';
		const baseSegment =
			sharedSource.match(/\n\t\.segmented-choice-segment\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		const buttonMarkup = sharedSource.match(/<button[\s\S]*?<\/button>/)?.[0] ?? '';

		// tap-press uses the individual scale property; boop and pressBounce write transform.
		expect(segmentModifier).toContain('scale: 1 !important');
		expect(segmentModifier).toContain('transform: none !important');
		expect(baseSegment).not.toContain('scale: 1 !important');
		expect(baseSegment).not.toContain('transform: none !important');

		// Default segments retain the existing pointer/touch feedback wiring.
		expect(buttonMarkup).toContain("'tap-press segmented-choice-segment'");
		expect(buttonMarkup).toContain('use:boop={{ scale: 1.04 }}');
		expect(buttonMarkup).toContain('use:pressBounce');
	});

	it('keeps the default variant flex-based with full labels', () => {
		const { getByRole } = renderPicker(ALL_ENABLED, 'week');
		const group = getByRole('radiogroup', { name: 'Roll-up period' });
		expect(group).toHaveAttribute('data-variant', 'default');
		expect(group).not.toHaveClass('segmented-choice--joined-grid');
		expect(within(group).getByRole('radio', { name: 'Week' })).toHaveTextContent('Week');

		const defaultRule =
			segmentedChoiceSource().match(/\.segmented-choice\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		expect(defaultRule).toContain('display: inline-flex');
		expect(defaultRule).not.toContain('grid-template-columns');
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
