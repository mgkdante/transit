import { describe, expect, it, vi } from 'vitest';
import { createChartDatumPopover, type ChartDatumPopoverModel } from '../index';
import type { MagnitudeDatum } from '../ChartSpec';
import { activateMagnitudeRow } from './magnitudeRowActivation';

const tapPopover: ChartDatumPopoverModel = {
	key: 'stop-S1',
	heading: 'Berri-UQAM',
	rows: [{ label: 'Severe-delay rate', value: '70%' }],
	action: {
		href: '/stop/S1',
		label: 'View stop',
		ariaLabel: 'View detail for Berri-UQAM',
	},
};

const linkedDatum: MagnitudeDatum = {
	key: 'stop-S1',
	label: 'Berri-UQAM',
	value: 70,
	href: '/stop/S1',
	tapPopover,
};

function click(pointerType: string): PointerEvent {
	return new PointerEvent('click', {
		bubbles: true,
		cancelable: true,
		clientX: 120,
		clientY: 240,
		pointerType,
	});
}

function notePointer(pointerType: string): PointerEvent {
	return new PointerEvent('pointerdown', { pointerType });
}

function compatibilityClick(): MouseEvent {
	return new MouseEvent('click', {
		bubbles: true,
		cancelable: true,
		clientX: 120,
		clientY: 240,
	});
}

describe('activateMagnitudeRow', () => {
	it.each(['touch', 'pen'])(
		'opens normalized details for %s and never navigates',
		(pointerType) => {
			const popover = createChartDatumPopover();
			const navigate = vi.fn();

			const result = activateMagnitudeRow(click(pointerType), linkedDatum, popover, navigate);

			expect(result).toBe('popover');
			expect(popover.open).toBe(true);
			expect(popover.model).toEqual(tapPopover);
			expect(navigate).not.toHaveBeenCalled();
		},
	);

	it('keeps normalized mouse activation as one direct navigation', () => {
		const popover = createChartDatumPopover();
		const navigate = vi.fn();

		const result = activateMagnitudeRow(click('mouse'), linkedDatum, popover, navigate);

		expect(result).toBe('navigate');
		expect(popover.open).toBe(false);
		expect(navigate).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith('/stop/S1');
	});

	it('uses the captured touch source for a compatibility click without navigating', () => {
		const popover = createChartDatumPopover();
		const navigate = vi.fn();
		popover.notePointerSource(notePointer('touch'));

		const result = activateMagnitudeRow(compatibilityClick(), linkedDatum, popover, navigate);

		expect(result).toBe('popover');
		expect(popover.open).toBe(true);
		expect(popover.model).toEqual(tapPopover);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('preserves captured touch ownership across empty and unknown pointer sources', () => {
		const popover = createChartDatumPopover();
		const navigate = vi.fn();
		popover.notePointerSource(notePointer('touch'));
		popover.notePointerSource(notePointer(''));
		popover.notePointerSource(notePointer('eraser'));

		expect(popover.showNativeTooltip).toBe(false);
		expect(activateMagnitudeRow(compatibilityClick(), linkedDatum, popover, navigate)).toBe(
			'popover',
		);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('restores native tooltip and direct activation after a captured mouse source', () => {
		const popover = createChartDatumPopover();
		const navigate = vi.fn();
		popover.notePointerSource(notePointer('touch'));
		popover.notePointerSource(notePointer('mouse'));

		expect(popover.showNativeTooltip).toBe(true);
		expect(activateMagnitudeRow(compatibilityClick(), linkedDatum, popover, navigate)).toBe(
			'navigate',
		);
		expect(popover.open).toBe(false);
		expect(navigate).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith('/stop/S1');
	});

	it('closes an active custom popover when an explicit mouse source takes ownership', () => {
		const popover = createChartDatumPopover();
		const navigate = vi.fn();
		popover.notePointerSource(notePointer('touch'));

		expect(activateMagnitudeRow(compatibilityClick(), linkedDatum, popover, navigate)).toBe(
			'popover',
		);
		expect(popover.open).toBe(true);

		popover.notePointerSource(notePointer('mouse'));

		expect(popover.open).toBe(false);
		expect(popover.model).toBeNull();
		expect(popover.showNativeTooltip).toBe(true);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('keeps captured touch ownership after close for the next compatibility activation', () => {
		const popover = createChartDatumPopover();
		const navigate = vi.fn();
		popover.notePointerSource(notePointer('touch'));

		expect(activateMagnitudeRow(compatibilityClick(), linkedDatum, popover, navigate)).toBe(
			'popover',
		);
		popover.close();
		expect(popover.showNativeTooltip).toBe(false);

		expect(activateMagnitudeRow(compatibilityClick(), linkedDatum, popover, navigate)).toBe(
			'popover',
		);
		expect(popover.open).toBe(true);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('opens an unlinked opted-in datum without inventing an action or navigation', () => {
		const informationOnly: MagnitudeDatum = {
			...linkedDatum,
			href: undefined,
			tapPopover: { ...tapPopover, action: undefined },
		};
		const popover = createChartDatumPopover();
		const navigate = vi.fn();

		const result = activateMagnitudeRow(click('touch'), informationOnly, popover, navigate);

		expect(result).toBe('popover');
		expect(popover.model?.action).toBeUndefined();
		expect(navigate).not.toHaveBeenCalled();
	});

	it('keeps the direct-navigation default when no popover model exists', () => {
		const popover = createChartDatumPopover();
		const navigate = vi.fn();
		const datum: MagnitudeDatum = { ...linkedDatum, tapPopover: undefined };

		const result = activateMagnitudeRow(click('touch'), datum, popover, navigate);

		expect(result).toBe('navigate');
		expect(navigate).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith('/stop/S1');
	});

	it('does nothing when neither a popover model nor href exists', () => {
		const popover = createChartDatumPopover();
		const navigate = vi.fn();
		const datum: MagnitudeDatum = {
			key: 'corridor-C1',
			label: 'Corridor C1',
			value: 20,
		};

		expect(activateMagnitudeRow(new MouseEvent('click'), datum, popover, navigate)).toBe('none');
		expect(navigate).not.toHaveBeenCalled();
	});

	it('falls through a declined popover activation to navigation exactly once', () => {
		const popover = createChartDatumPopover();
		const navigate = vi.fn();

		expect(activateMagnitudeRow(click('mouse'), linkedDatum, popover, navigate)).toBe('navigate');
		expect(navigate).toHaveBeenCalledTimes(1);
	});
});
