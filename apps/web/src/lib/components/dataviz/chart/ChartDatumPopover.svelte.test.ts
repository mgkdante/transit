import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChartDatumPopoverHarness from './__fixtures__/ChartDatumPopoverHarness.svelte';

const LINKED_HEADING = 'Route 24 · Sherbrooke';
const INFORMATION_HEADING = 'Route 55 · Saint-Laurent';

function source(): string {
	return readFileSync(
		resolve(process.cwd(), 'src/lib/components/dataviz/chart/ChartDatumPopover.svelte'),
		'utf8',
	);
}

async function activate(
	testId: 'linked-trigger' | 'information-trigger',
	pointerType: string,
	clientX = 160,
	clientY = 320,
): Promise<void> {
	await pointerClick(screen.getByTestId(testId), pointerType, clientX, clientY);
}

async function pointerClick(
	element: Element,
	pointerType: string,
	clientX: number,
	clientY: number,
): Promise<void> {
	await fireEvent(
		element,
		new PointerEvent('click', {
			bubbles: true,
			cancelable: true,
			pointerType,
			clientX,
			clientY,
		}),
	);
}

function mockDialogRect(width: number, height: number): void {
	const original = HTMLElement.prototype.getBoundingClientRect;
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
		this: HTMLElement,
	) {
		if (this.getAttribute('role') === 'dialog') {
			return {
				x: 0,
				y: 0,
				left: 0,
				top: 0,
				right: width,
				bottom: height,
				width,
				height,
				toJSON: () => ({}),
			};
		}
		return original.call(this);
	});
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	document.querySelectorAll('[role="dialog"]').forEach((element) => element.remove());
});

describe('ChartDatumPopover activation and content', () => {
	it('ignores mouse and empty pointer activation without changing controller state', async () => {
		render(ChartDatumPopoverHarness);
		const harness = screen.getByTestId('chart-popover-harness');

		await activate('linked-trigger', 'mouse', 80, 90);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(harness).toHaveAttribute('data-last-activation', 'false');
		expect(harness).toHaveAttribute('data-model-key', '');
		expect(harness).toHaveAttribute('data-x', '0');
		expect(harness).toHaveAttribute('data-y', '0');

		await activate('linked-trigger', '', 120, 140);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(harness).toHaveAttribute('data-last-activation', 'false');
		expect(harness).toHaveAttribute('data-open', 'false');
	});

	it('does not activate from touch pointerdown without a completed native click', async () => {
		render(ChartDatumPopoverHarness);
		const harness = screen.getByTestId('chart-popover-harness');

		await fireEvent.pointerDown(screen.getByTestId('linked-trigger'), {
			pointerType: 'touch',
			clientX: 140,
			clientY: 220,
		});

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(harness).toHaveAttribute('data-last-activation', 'unset');
		expect(harness).toHaveAttribute('data-model-key', '');
	});

	it.each(['touch', 'pen'])('opens for %s activation and reports success', async (pointerType) => {
		render(ChartDatumPopoverHarness);

		await activate('linked-trigger', pointerType, 140, 220);

		expect(await screen.findByRole('dialog', { name: LINKED_HEADING })).toBeInTheDocument();
		expect(screen.getByTestId('chart-popover-harness')).toHaveAttribute(
			'data-last-activation',
			'true',
		);
	});

	it.each(['touch', 'pen'])(
		'moves focus into the %s dialog, associates its trigger, and restores focus on close',
		async (pointerType) => {
			render(ChartDatumPopoverHarness);
			const trigger = screen.getByTestId('linked-trigger');
			trigger.focus();

			await activate('linked-trigger', pointerType);
			const dialog = await screen.findByRole('dialog', { name: LINKED_HEADING });
			await waitFor(() => expect(dialog).toHaveFocus());
			expect(dialog).toHaveAttribute('tabindex', '-1');
			expect(trigger).toHaveAttribute('aria-controls', dialog.id);
			expect(trigger).toHaveAttribute('aria-expanded', 'true');

			await fireEvent.keyDown(document, { key: 'Escape' });
			await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
			expect(trigger).toHaveFocus();
			expect(trigger).not.toHaveAttribute('aria-controls');
			expect(trigger).not.toHaveAttribute('aria-expanded');
		},
	);

	it('portals the named dialog outside the harness and renders semantic evidence', async () => {
		render(ChartDatumPopoverHarness);
		await activate('linked-trigger', 'touch');

		const dialog = await screen.findByRole('dialog', { name: LINKED_HEADING });
		const harness = screen.getByTestId('chart-popover-harness');
		const heading = within(dialog).getByRole('heading', { name: LINKED_HEADING });

		expect(harness.contains(dialog)).toBe(false);
		expect(dialog.parentElement).toBe(document.body);
		expect(dialog).toHaveAttribute('aria-modal', 'false');
		expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
		expect(heading.id).toBe(`${dialog.id}-heading`);
		expect(within(dialog).getByText('Weekdays · 07:00–09:00')).toBeInTheDocument();
		expect(dialog.querySelectorAll('dl')).toHaveLength(1);
		expect(
			Array.from(dialog.querySelectorAll('dt')).map((node) => node.textContent?.trim()),
		).toEqual(['Median wait', 'Observed trips']);
		expect(Array.from(dialog.querySelectorAll('dd')).map((node) => node.textContent)).toEqual([
			'6 min',
			'42',
		]);
		expect(dialog.querySelectorAll('[data-swatch]')).toHaveLength(1);
	});

	it('renders the supplied same-tab action exactly and omits it for information-only content', async () => {
		render(ChartDatumPopoverHarness);
		await activate('linked-trigger', 'touch');

		let dialog = await screen.findByRole('dialog', { name: LINKED_HEADING });
		const action = within(dialog).getByRole('link', { name: 'View details for line 24' });
		expect(action).toHaveAttribute('href', '/lines/24');
		expect(action).toHaveTextContent('View line 24');
		expect(action).toHaveAttribute('aria-label', 'View details for line 24');
		expect(action).not.toHaveAttribute('target');

		await activate('information-trigger', 'pen');
		dialog = await screen.findByRole('dialog', { name: INFORMATION_HEADING });
		expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
	});

	it('keeps repeated keys open and replaces content and anchor for a new model', async () => {
		render(ChartDatumPopoverHarness);
		const harness = screen.getByTestId('chart-popover-harness');

		await activate('linked-trigger', 'touch', 100, 200);
		expect(await screen.findByRole('dialog', { name: LINKED_HEADING })).toBeInTheDocument();

		await activate('linked-trigger', 'pen', 110, 210);
		expect(screen.getByRole('dialog', { name: LINKED_HEADING })).toBeInTheDocument();
		expect(harness).toHaveAttribute('data-open', 'true');
		expect(harness).toHaveAttribute('data-x', '110');
		expect(harness).toHaveAttribute('data-y', '210');

		await activate('information-trigger', 'touch', 300, 400);
		expect(await screen.findByRole('dialog', { name: INFORMATION_HEADING })).toBeInTheDocument();
		expect(screen.queryByText(LINKED_HEADING)).not.toBeInTheDocument();
		expect(harness).toHaveAttribute('data-model-key', 'route-55-midday');
		expect(harness).toHaveAttribute('data-x', '300');
		expect(harness).toHaveAttribute('data-y', '400');
	});

	it('uses deterministic monotonically increasing ids with the required prefix', async () => {
		const first = render(ChartDatumPopoverHarness);
		const firstHarness = first.container.querySelector(
			'[data-testid="chart-popover-harness"]',
		) as HTMLElement;
		await pointerClick(
			first.container.querySelector('[data-testid="linked-trigger"]')!,
			'touch',
			100,
			200,
		);

		const second = render(ChartDatumPopoverHarness);
		const secondHarness = second.container.querySelector(
			'[data-testid="chart-popover-harness"]',
		) as HTMLElement;
		await pointerClick(
			second.container.querySelector('[data-testid="linked-trigger"]')!,
			'touch',
			120,
			220,
		);

		const firstId = firstHarness.dataset.controllerId ?? '';
		const secondId = secondHarness.dataset.controllerId ?? '';
		expect(firstId).toMatch(/^chart-datum-popover-\d+$/);
		expect(secondId).toMatch(/^chart-datum-popover-\d+$/);
		expect(Number(secondId.split('-').at(-1))).toBe(Number(firstId.split('-').at(-1)) + 1);
	});
});

describe('ChartDatumPopover viewport placement', () => {
	it('uses fixed viewport pixels, flips below, shifts horizontally, and stays inside 390px', async () => {
		vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
		vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
		mockDialogRect(220, 180);
		render(ChartDatumPopoverHarness);

		await activate('linked-trigger', 'touch', 380, 12);
		const dialog = await screen.findByRole('dialog', { name: LINKED_HEADING });
		await waitFor(() => {
			expect(dialog.style.left).toBe('162px');
			expect(dialog.style.top).toBe('20px');
			expect(dialog).toHaveAttribute('data-placed', 'true');
		});

		expect(source()).toMatch(/\.chart-datum-popover\s*\{[\s\S]*?position:\s*fixed;/);
		const left = Number.parseFloat(dialog.style.left);
		const top = Number.parseFloat(dialog.style.top);
		expect(left).toBeGreaterThanOrEqual(8);
		expect(left + 220).toBeLessThanOrEqual(390 - 8);
		expect(top).toBeGreaterThanOrEqual(8);
		expect(top + 180).toBeLessThanOrEqual(844 - 8);
	});
});

describe('ChartDatumPopover dismissal and cleanup', () => {
	it('dismisses on an outside document pointerdown without restoring focus over the new target', async () => {
		render(ChartDatumPopoverHarness);
		const trigger = screen.getByTestId('linked-trigger');
		await activate('linked-trigger', 'touch');
		expect(await screen.findByRole('dialog')).toBeInTheDocument();
		const focusTrigger = vi.spyOn(trigger as HTMLElement, 'focus');

		await fireEvent.pointerDown(screen.getByTestId('outside-focus-target'), {
			pointerType: 'mouse',
		});
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(focusTrigger).not.toHaveBeenCalled();
		expect(trigger).not.toHaveAttribute('aria-controls');
	});

	it('dismisses on Escape', async () => {
		render(ChartDatumPopoverHarness);
		await activate('linked-trigger', 'touch');
		expect(await screen.findByRole('dialog')).toBeInTheDocument();

		await fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
	});

	it('keeps focus moves within the popover open and dismisses focus moving outside', async () => {
		render(ChartDatumPopoverHarness);
		await activate('linked-trigger', 'touch');
		const dialog = await screen.findByRole('dialog');
		const action = within(dialog).getByRole('link');

		await fireEvent.focusOut(action, { relatedTarget: dialog });
		expect(screen.getByRole('dialog')).toBeInTheDocument();

		await fireEvent.focusOut(action, {
			relatedTarget: screen.getByTestId('outside-focus-target'),
		});
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
	});

	it('dismisses on capture-phase ancestor scroll', async () => {
		render(ChartDatumPopoverHarness);
		await activate('linked-trigger', 'touch');
		expect(await screen.findByRole('dialog')).toBeInTheDocument();

		await fireEvent.scroll(screen.getByTestId('chart-popover-harness'));
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
	});

	it('stays open when the scroll originates inside its own overflow surface', async () => {
		render(ChartDatumPopoverHarness);
		await activate('linked-trigger', 'touch');
		const dialog = await screen.findByRole('dialog');

		await fireEvent.scroll(dialog);

		expect(screen.getByRole('dialog')).toBe(dialog);
	});

	it.each(['resize', 'orientationchange'])('dismisses on window %s', async (eventName) => {
		render(ChartDatumPopoverHarness);
		await activate('linked-trigger', 'touch');
		expect(await screen.findByRole('dialog')).toBeInTheDocument();

		window.dispatchEvent(new Event(eventName));
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
	});

	it('dismisses through the explicit controller close', async () => {
		render(ChartDatumPopoverHarness);
		const trigger = screen.getByTestId('linked-trigger');
		await activate('linked-trigger', 'touch');
		expect(await screen.findByRole('dialog')).toBeInTheDocument();

		await fireEvent.click(screen.getByTestId('explicit-close'));
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(trigger).toHaveFocus();
		expect(screen.getByTestId('chart-popover-harness')).toHaveAttribute('data-model-key', '');
	});

	it('installs one dismissal listener set and removes it with the portaled DOM on unmount', async () => {
		const documentAdd = vi.spyOn(document, 'addEventListener');
		const documentRemove = vi.spyOn(document, 'removeEventListener');
		const windowAdd = vi.spyOn(window, 'addEventListener');
		const windowRemove = vi.spyOn(window, 'removeEventListener');
		const view = render(ChartDatumPopoverHarness);

		await pointerClick(view.getByTestId('linked-trigger'), 'touch', 120, 220);
		expect(await screen.findByRole('dialog')).toBeInTheDocument();
		await waitFor(() => {
			expect(
				documentAdd.mock.calls.filter(
					([type, , options]) => type === 'pointerdown' && options === true,
				),
			).toHaveLength(1);
			expect(documentAdd.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
			expect(windowAdd.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1);
			expect(windowAdd.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
			expect(windowAdd.mock.calls.filter(([type]) => type === 'orientationchange')).toHaveLength(1);
		});

		const documentListeners = documentAdd.mock.calls.filter(
			([type, , options]) => type === 'keydown' || (type === 'pointerdown' && options === true),
		);
		const windowListeners = windowAdd.mock.calls.filter(([type]) =>
			['scroll', 'resize', 'orientationchange'].includes(String(type)),
		);

		await view.unmount();

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		for (const call of documentListeners) {
			expect(documentRemove).toHaveBeenCalledWith(...call);
		}
		for (const call of windowListeners) {
			expect(windowRemove).toHaveBeenCalledWith(...call);
		}
	});
});

describe('ChartDatumPopover styling contracts', () => {
	it('uses the interaction token for action focus-visible and removes entrance motion when reduced', () => {
		const css = source();
		expect(css).toMatch(
			/\.chart-datum-popover__action:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--ring\);[\s\S]*?\}/,
		);
		expect(css).toMatch(
			/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.chart-datum-popover--placed\s*\{[\s\S]*?animation:\s*none;[\s\S]*?\}/,
		);
	});
});
