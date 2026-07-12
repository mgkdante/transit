import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ChartDatumPopoverModel } from '../useChartDatumPopover.svelte';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: navigate }));

import MagnitudeBarsMark from './MagnitudeBarsMark.svelte';
import type { MagnitudeBarsSpec } from '../ChartSpec';

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

// A row carrying Wilson bounds, used to prove the CI surfaces ONLY when spec.ciLabel is set (the
// defensive guard). The sr-only table is the structure-independent AT mirror.
const rowWithCi = {
	key: 's1',
	label: 'Stop One',
	value: 44,
	severity: 'high' as const,
	wilsonLo: 31,
	wilsonHi: 57,
	note: 'median 0.4 min · n=120',
	href: '/stop/s1',
};

const tapPopover: ChartDatumPopoverModel = {
	key: 's1',
	heading: 'Stop One',
	rows: [
		{ label: 'Severe-delay rate', value: '44%' },
		{ label: '95% CI', value: '31%–57%' },
	],
	action: {
		href: '/stop/s1',
		label: 'View stop',
		ariaLabel: 'View detail for Stop One',
	},
};

const baseSpec = (ciLabel?: string, optedIn = false): MagnitudeBarsSpec => ({
	kind: 'magnitude-bars',
	mark: 'bar',
	title: 'Worst stops',
	locale: 'en',
	domain: [0, 100],
	unit: '%',
	xLabel: 'Severe-delay rate',
	rows: [{ ...rowWithCi, ...(optedIn ? { tapPopover } : {}) }],
	sort: 'given',
	scale: 'severity',
	ciLabel,
});

const cell = (c: HTMLElement): string =>
	c.querySelector('table.sr-only tbody tr td')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

function renderReadyMark(spec: MagnitudeBarsSpec) {
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(768);
	vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
	Object.defineProperty(Element.prototype, 'animate', {
		configurable: true,
		value: vi.fn(() => ({
			cancel: vi.fn(),
			currentTime: 0,
			effect: null,
			onfinish: null,
			playState: 'finished',
		})),
	});
	return render(MagnitudeBarsMark, { props: { spec } });
}

async function tooltipContext(container: HTMLElement): Promise<HTMLElement> {
	return waitFor(() => {
		const context = container.querySelector<HTMLElement>('.lc-tooltip-context');
		if (!context) throw new Error('Expected LayerChart tooltip context');
		return context;
	});
}

async function rowOverlay(container: HTMLElement): Promise<SVGRectElement> {
	return waitFor(() => {
		const overlay = container.querySelector<SVGRectElement>('rect.lc-tooltip-rect');
		if (!overlay) throw new Error('Expected LayerChart magnitude row overlay');
		return overlay;
	});
}

async function pointerClick(element: Element, pointerType: string): Promise<void> {
	await fireEvent(
		element,
		new PointerEvent('click', {
			bubbles: true,
			cancelable: true,
			clientX: 120,
			clientY: 240,
			pointerType,
		}),
	);
}

afterEach(() => {
	cleanup();
	navigate.mockClear();
	vi.restoreAllMocks();
	if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
	else Reflect.deleteProperty(Element.prototype, 'animate');
	document.querySelectorAll('[role="dialog"]').forEach((element) => element.remove());
});

describe('MagnitudeBarsMark — Wilson CI surfacing guard (PR-WEB-2 Feature B)', () => {
	it('surfaces the CI in the sr-only cell when ciLabel is set AND the row has both bounds', () => {
		const { container } = render(MagnitudeBarsMark, { props: { spec: baseSpec('95% CI') } });
		expect(cell(container)).toContain('95% CI');
		expect(cell(container)).toContain('31');
		expect(cell(container)).toContain('57');
	});

	it('shows NO CI when ciLabel is unset, even though the row carries Wilson bounds (the guard)', () => {
		const { container } = render(MagnitudeBarsMark, { props: { spec: baseSpec(undefined) } });
		const txt = cell(container);
		expect(txt).toContain('44'); // the value still renders
		expect(txt).not.toContain('('); // no fabricated CI parenthetical
		expect(txt).not.toContain('31');
		expect(txt).not.toContain('57');
	});
});

describe('MagnitudeBarsMark — touch datum popover integration', () => {
	it('keeps an opted-in touch sequence exclusive before opening one custom dialog', async () => {
		const { container } = renderReadyMark(baseSpec('95% CI', true));
		const overlay = await rowOverlay(container);
		const touch = {
			pointerType: 'touch',
			clientX: 120,
			clientY: 240,
		};

		await act(() => {
			overlay.dispatchEvent(
				new PointerEvent('pointerover', { ...touch, bubbles: true, cancelable: true }),
			);
			overlay.dispatchEvent(
				new PointerEvent('pointerenter', { ...touch, bubbles: false, cancelable: false }),
			);
			overlay.dispatchEvent(
				new PointerEvent('pointermove', { ...touch, bubbles: true, cancelable: true }),
			);
			overlay.dispatchEvent(
				new PointerEvent('pointerdown', { ...touch, bubbles: true, cancelable: true }),
			);
		});

		expect(document.querySelector('.lc-tooltip-root')).not.toBeInTheDocument();
		expect(document.querySelector('.lc-tooltip-content')).not.toBeInTheDocument();

		await fireEvent.pointerUp(overlay, touch);
		await pointerClick(overlay, 'touch');

		const dialogs = await screen.findAllByRole('dialog', { name: 'Stop One' });
		expect(dialogs).toHaveLength(1);
		expect(document.querySelector('.lc-tooltip-root')).not.toBeInTheDocument();
		expect(document.querySelector('.lc-tooltip-content')).not.toBeInTheDocument();
		expect(navigate).not.toHaveBeenCalled();

		const action = within(dialogs[0]).getByRole('link', {
			name: 'View detail for Stop One',
		});
		expect(action).toHaveAttribute('href', '/stop/s1');
		expect(action).toHaveTextContent('View stop');
	});

	it('opens one shared popover for an opted-in touch row without navigating', async () => {
		const { container } = renderReadyMark(baseSpec('95% CI', true));

		await pointerClick(await rowOverlay(container), 'touch');

		expect(await screen.findAllByRole('dialog', { name: 'Stop One' })).toHaveLength(1);
		expect(navigate).not.toHaveBeenCalled();
	});

	it('hands a touch-open datum to mouse hover without overlapping or navigating', async () => {
		const { container } = renderReadyMark(baseSpec('95% CI', true));
		const overlay = await rowOverlay(container);
		const initialHref = window.location.href;

		await pointerClick(overlay, 'touch');
		expect(await screen.findAllByRole('dialog', { name: 'Stop One' })).toHaveLength(1);
		expect(navigate).not.toHaveBeenCalled();

		const mouse = {
			pointerType: 'mouse',
			clientX: 120,
			clientY: 240,
		};
		await fireEvent.pointerOver(overlay, mouse);
		await fireEvent.pointerEnter(overlay, mouse);
		await fireEvent.pointerMove(overlay, mouse);

		await waitFor(() => {
			expect(document.querySelectorAll('.lc-tooltip-root')).toHaveLength(1);
		});
		expect(screen.queryAllByRole('dialog', { name: 'Stop One' })).toHaveLength(0);
		expect(navigate).not.toHaveBeenCalled();
		expect(window.location.href).toBe(initialHref);

		await pointerClick(overlay, 'mouse');
		expect(navigate).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith('/stop/s1');
	});

	it('opts LayerChart into auto touch events only when at least one row has a popover model', async () => {
		const optedIn = renderReadyMark(baseSpec('95% CI', true));
		expect((await tooltipContext(optedIn.container)).style.getPropertyValue('--touch-action')).toBe(
			'auto',
		);
		optedIn.unmount();

		const defaultView = render(MagnitudeBarsMark, {
			props: { spec: baseSpec('95% CI') },
		});
		expect(
			(await tooltipContext(defaultView.container)).style.getPropertyValue('--touch-action'),
		).toBe('pan-y');
	});

	it('keeps hover metrics and evidence while removing the hardcoded pseudo action', async () => {
		const { container } = renderReadyMark(baseSpec('95% CI', true));
		await fireEvent.pointerEnter(await rowOverlay(container), {
			pointerType: 'mouse',
			clientX: 120,
			clientY: 240,
		});

		const hover = await waitFor(() => {
			const content = document.querySelector<HTMLElement>('.lc-tooltip-content');
			if (!content) throw new Error('Expected rendered LayerChart hover content');
			return content;
		});
		expect(within(hover).getByText('Stop One')).toBeInTheDocument();
		expect(within(hover).getByText('44%')).toBeInTheDocument();
		expect(within(hover).getByText('31–57%')).toBeInTheDocument();
		expect(within(hover).getByText('median 0.4 min · n=120')).toBeInTheDocument();
		expect(within(hover).queryByText('↦ open stop')).not.toBeInTheDocument();
	});

	it('keeps a non-opted-in mark on pan-y with its native mouse tooltip', async () => {
		const { container } = renderReadyMark(baseSpec('95% CI'));
		expect((await tooltipContext(container)).style.getPropertyValue('--touch-action')).toBe(
			'pan-y',
		);

		await fireEvent.pointerEnter(await rowOverlay(container), {
			pointerType: 'mouse',
			clientX: 120,
			clientY: 240,
		});

		const hover = await waitFor(() => {
			const content = document.querySelector<HTMLElement>('.lc-tooltip-content');
			if (!content) throw new Error('Expected non-opted native LayerChart tooltip');
			return content;
		});
		expect(within(hover).getByText('Stop One')).toBeInTheDocument();
		expect(within(hover).getByText('44%')).toBeInTheDocument();
	});

	it('keeps desktop mouse activation as one direct navigation', async () => {
		const { container } = renderReadyMark(baseSpec('95% CI', true));

		await pointerClick(await rowOverlay(container), 'mouse');

		expect(navigate).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith('/stop/s1');
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
