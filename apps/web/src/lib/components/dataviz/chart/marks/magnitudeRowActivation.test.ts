import { describe, expect, it, vi } from 'vitest';
import {
	chartDatumPopoverBoundary,
	createChartDatumPopover,
	type ChartDatumPopoverModel,
} from '../index';
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

function mountedRowBoundary() {
	const popover = createChartDatumPopover();
	const navigate = vi.fn();
	const boundary = document.createElement('figure');
	const row = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
	const other = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
	boundary.append(row, other);
	document.body.append(boundary);
	const action = chartDatumPopoverBoundary(boundary, popover);
	let destroyed = false;
	let result: ReturnType<typeof activateMagnitudeRow> | undefined;
	boundary.addEventListener('click', (event) => {
		result = activateMagnitudeRow(event, linkedDatum, popover, navigate);
	});
	return {
		popover,
		navigate,
		row,
		other,
		get result() {
			return result;
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			action.destroy();
			boundary.remove();
		},
	};
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

	it('keeps a completed touch gesture when its compatibility click reports mouse', () => {
		const h = mountedRowBoundary();

		try {
			h.row.dispatchEvent(
				new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			h.row.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			h.row.dispatchEvent(
				new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			h.row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			h.row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			h.row.dispatchEvent(
				new PointerEvent('click', { bubbles: true, pointerType: 'mouse', pointerId: 1 }),
			);

			expect(h.result).toBe('popover');
			expect(h.popover.open).toBe(true);
			expect(h.navigate).not.toHaveBeenCalled();

			h.popover.close(false);
			expect(activateMagnitudeRow(compatibilityClick(), linkedDatum, h.popover, h.navigate)).toBe(
				'navigate',
			);
			expect(h.popover.open).toBe(false);
			expect(h.navigate).toHaveBeenCalledOnce();
			h.navigate.mockClear();

			h.row.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 1 }),
			);
			h.row.dispatchEvent(
				new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', pointerId: 1 }),
			);
			h.row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			h.row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			h.row.dispatchEvent(
				new PointerEvent('click', { bubbles: true, pointerType: 'mouse', pointerId: 1 }),
			);

			expect(h.result).toBe('navigate');
			expect(h.popover.open).toBe(false);
			expect(h.navigate).toHaveBeenCalledOnce();
		} finally {
			h.destroy();
		}
	});

	it('preserves pen activation when compatibility mousedown precedes pointerup', () => {
		const h = mountedRowBoundary();
		try {
			h.row.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, pointerType: 'pen', pointerId: 8 }),
			);
			h.row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			h.row.dispatchEvent(
				new PointerEvent('pointerup', { bubbles: true, pointerType: 'pen', pointerId: 8 }),
			);
			h.row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			h.row.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(h.result).toBe('popover');
			expect(h.popover.open).toBe(true);
			expect(h.navigate).not.toHaveBeenCalled();
		} finally {
			h.destroy();
		}
	});

	it('drops a canceled touch before a later untyped click', () => {
		const h = mountedRowBoundary();
		try {
			h.row.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			h.row.dispatchEvent(
				new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			expect(activateMagnitudeRow(compatibilityClick(), linkedDatum, h.popover, h.navigate)).toBe(
				'navigate',
			);
			expect(h.popover.open).toBe(false);
			expect(h.navigate).toHaveBeenCalledOnce();
		} finally {
			h.destroy();
		}
	});

	it('clears an unfinished touch when its boundary closes or unmounts', () => {
		const h = mountedRowBoundary();
		try {
			h.row.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			h.popover.close(false);
			expect(activateMagnitudeRow(compatibilityClick(), linkedDatum, h.popover, h.navigate)).toBe(
				'navigate',
			);

			h.row.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 3 }),
			);
			h.destroy();
			expect(activateMagnitudeRow(compatibilityClick(), linkedDatum, h.popover, h.navigate)).toBe(
				'navigate',
			);
			expect(h.navigate).toHaveBeenCalledTimes(2);
		} finally {
			h.destroy();
		}
	});

	it('does not give a different row the previous touch gesture', () => {
		const h = mountedRowBoundary();
		try {
			h.row.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			h.row.dispatchEvent(
				new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			h.other.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			h.other.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			h.other.dispatchEvent(
				new PointerEvent('click', { bubbles: true, pointerType: 'mouse', pointerId: 1 }),
			);
			expect(h.result).toBe('navigate');
			expect(h.popover.open).toBe(false);
			expect(h.navigate).toHaveBeenCalledOnce();
		} finally {
			h.destroy();
		}
	});

	it('lets genuine mouse pointerover replace a pending touch', () => {
		const h = mountedRowBoundary();
		try {
			h.row.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			h.row.dispatchEvent(
				new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 2 }),
			);
			h.row.dispatchEvent(
				new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', pointerId: 1 }),
			);
			expect(h.popover.showNativeTooltip).toBe(true);
			h.row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			h.row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			h.row.dispatchEvent(
				new PointerEvent('click', { bubbles: true, pointerType: 'mouse', pointerId: 1 }),
			);
			expect(h.result).toBe('navigate');
			expect(h.navigate).toHaveBeenCalledOnce();
		} finally {
			h.destroy();
		}
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
