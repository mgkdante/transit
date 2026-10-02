import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick, type ComponentProps } from 'svelte';
import Harness from './__fixtures__/DismissibleLayerTouchHarness.svelte';

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
	cleanup();
	await tick();
	vi.clearAllTimers();
	vi.useRealTimers();
});

async function mounted(props: ComponentProps<typeof Harness> = {}) {
	const view = render(Harness, { props });
	await tick();
	await vi.advanceTimersByTimeAsync(5);
	await tick();
	return view;
}
async function down(target: Element, pointerType = 'touch') {
	await fireEvent.pointerDown(target, {
		pointerType,
		pointerId: 7,
		button: 0,
		clientX: 300,
		clientY: 300,
		composed: true,
	});
}
function click(target: Element, detail = 1) {
	const event = new MouseEvent('click', {
		bubbles: true,
		cancelable: true,
		composed: true,
		button: 0,
		clientX: 300,
		clientY: 300,
		detail,
	});
	target.dispatchEvent(event);
	return event;
}
async function advance(ms = 15) {
	await vi.advanceTimersByTimeAsync(ms);
	await tick();
}

describe('tracked Bits touch outside-interaction patch', () => {
	it.each([0, 15])(
		'delivers the same original outside click exactly once when click arrives after %ims',
		async (delay) => {
			const onOuterOutside = vi.fn();
			await mounted({ onOuterOutside });
			const outside = screen.getByTestId('outside');
			await down(outside);
			await advance(delay);
			expect(onOuterOutside).not.toHaveBeenCalled();
			const originalClick = click(outside);
			if (delay === 0) expect(onOuterOutside).not.toHaveBeenCalled();
			await advance();
			expect(onOuterOutside).toHaveBeenCalledExactlyOnceWith(originalClick);
			expect(originalClick.target).toBe(outside);
			expect(screen.queryByRole('dialog', { name: 'Outer' })).not.toBeInTheDocument();
			click(outside);
			await advance();
			expect(onOuterOutside).toHaveBeenCalledOnce();
		},
	);

	it('never assigns an uncompleted outside touch to the next inside interaction', async () => {
		const onOuterOutside = vi.fn();
		await mounted({ onOuterOutside });
		await down(screen.getByTestId('outside'));
		await advance();
		const inside = screen.getByTestId('inside');
		await down(inside, 'mouse');
		click(inside);
		await advance();
		expect(onOuterOutside).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
	});

	it('clears a canceled drag without dismissing on an unrelated later click', async () => {
		const onOuterOutside = vi.fn();
		await mounted({ onOuterOutside });
		const outside = screen.getByTestId('outside');
		await down(outside);
		await advance();
		await fireEvent.pointerCancel(outside, {
			pointerType: 'touch',
			pointerId: 7,
			bubbles: true,
			composed: true,
		});
		click(outside);
		await advance();
		expect(onOuterOutside).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
	});

	it('does not substitute a keyboard click for a pending touch click', async () => {
		const onOuterOutside = vi.fn();
		await mounted({ onOuterOutside });
		const outside = screen.getByTestId('outside');
		await down(outside);
		await advance();
		click(outside, 0);
		await advance();
		expect(onOuterOutside).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
	});

	it('keeps interception authoritative even for a fast subsequent click', async () => {
		const onOuterOutside = vi.fn();
		await mounted({ onOuterOutside, interceptStart: true });
		const outside = screen.getByTestId('outside');
		await down(outside);
		click(outside);
		await advance();
		expect(onOuterOutside).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
	});

	it('delivers only to the layer responsible at interaction start', async () => {
		const onOuterOutside = vi.fn(),
			onInnerOutside = vi.fn();
		await mounted({ onOuterOutside, onInnerOutside });
		await fireEvent.click(screen.getByTestId('open-inner'));
		await advance(5);
		expect(screen.getByRole('dialog', { name: 'Inner' })).toBeInTheDocument();
		const outside = screen.getByTestId('outside');
		await down(outside);
		const originalClick = click(outside);
		await advance();
		expect(onInnerOutside).toHaveBeenCalledExactlyOnceWith(originalClick);
		expect(onOuterOutside).not.toHaveBeenCalled();
		expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument();
		expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
	});

	it('preserves Dialog dismissal cancellation using the original event', async () => {
		const onOuterOutside = vi.fn((event: PointerEvent) => event.preventDefault());
		await mounted({ onOuterOutside });
		const outside = screen.getByTestId('outside');
		await down(outside);
		const originalClick = click(outside);
		await advance();
		expect(onOuterOutside).toHaveBeenCalledExactlyOnceWith(originalClick);
		expect(originalClick.defaultPrevented).toBe(true);
		expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
	});

	it.each(['disable', 'unmount'])(
		'cancels a captured click when the layer is %s before deferred validation',
		async (mode) => {
			const onOuterOutside = vi.fn();
			const view = await mounted({ onOuterOutside });
			const outside = screen.getByTestId('outside');
			await down(outside);
			click(outside);
			if (mode === 'disable') await fireEvent.click(screen.getByTestId('disable'));
			else await view.unmount();
			await advance();
			expect(onOuterOutside).not.toHaveBeenCalled();
		},
	);

	it('leaves the original mouse outside path intact', async () => {
		const onOuterOutside = vi.fn();
		await mounted({ onOuterOutside });
		await down(screen.getByTestId('outside'), 'mouse');
		await advance();
		expect(onOuterOutside).toHaveBeenCalledOnce();
		expect(onOuterOutside.mock.calls[0][0].type).toBe('pointerdown');
		expect(screen.queryByRole('dialog', { name: 'Outer' })).not.toBeInTheDocument();
	});
});
