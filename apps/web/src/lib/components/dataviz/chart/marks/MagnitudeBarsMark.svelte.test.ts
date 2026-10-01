import { observeChartFrames } from '../__fixtures__/observeChartFrames';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ChartDatumPopoverModel } from '../useChartDatumPopover.svelte';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: navigate }));

import MagnitudeBarsMark from './MagnitudeBarsMark.svelte';
import type { MagnitudeBarsSpec } from '../ChartSpec';

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

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
	rowLabel: 'Stop',
	rows: [{ ...rowWithCi, ...(optedIn ? { tapPopover } : {}) }],
	sort: 'given',
	scale: 'severity',
	ciLabel,
});

const cell = (c: HTMLElement): string =>
	c.querySelector('table.sr-only tbody tr td')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

function renderReadyMark(spec: MagnitudeBarsSpec) {
	vi.stubGlobal('IntersectionObserver', undefined);
	observeChartFrames(768, 400);
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
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
	else Reflect.deleteProperty(Element.prototype, 'animate');
	document.querySelectorAll('[role="dialog"]').forEach((element) => element.remove());
});

describe('MagnitudeBarsMark — Wilson CI surfacing guard (PR-WEB-2 Feature B)', () => {
	it('surfaces the CI in the sr-only cell when ciLabel is set AND the row has both bounds', () => {
		const { container } = render(MagnitudeBarsMark, { props: { spec: baseSpec('95% CI') } });
		expect(cell(container)).toBe('44% (95% CI 31%–57%)');
	});

	it('shows NO CI when ciLabel is unset, even though the row carries Wilson bounds (the guard)', () => {
		const { container } = render(MagnitudeBarsMark, { props: { spec: baseSpec(undefined) } });
		const txt = cell(container);
		expect(txt).toBe('44%');
		expect(txt).not.toContain('(');
		expect(txt).not.toContain('31');
		expect(txt).not.toContain('57');
	});
});

describe('MagnitudeBarsMark — localized semantic AT table', () => {
	it('keeps a visible chart entry available while its plot waits to mount', () => {
		const { container } = render(MagnitudeBarsMark, { props: { spec: baseSpec('95% CI') } });
		const figure = container.querySelector('figure') as HTMLElement;
		const tableLink = within(figure.querySelector('table')!).getByRole('link', {
			name: 'Stop One',
		});
		expect(figure.querySelector('.lc-root-container')).not.toBeInTheDocument();
		expect(figure).toHaveAttribute('tabindex', '0');
		expect(tableLink).toHaveAttribute('tabindex', '-1');
		figure.focus();
		expect(figure).toHaveFocus();
	});

	it.each([
		['en', 'Line', 'Severe-delay rate'],
		['en', 'Stop', 'Severe-delay rate'],
		['en', 'Trip', 'Severe-delay rate'],
		['en', 'Vehicle', 'Severe-delay rate'],
		['fr', 'Ligne', 'Taux de retard grave'],
		['fr', 'Arrêt', 'Taux de retard grave'],
		['fr', 'Voyage', 'Taux de retard grave'],
		['fr', 'Véhicule', 'Taux de retard grave'],
	] as const)(
		'uses %s %s and the localized value label as column headings',
		(locale, rowLabel, xLabel) => {
			const { container } = render(MagnitudeBarsMark, {
				props: { spec: { ...baseSpec('95% CI'), locale, rowLabel, xLabel } },
			});
			const table = container.querySelector('table.sr-only') as HTMLTableElement;

			expect(
				within(table)
					.getAllByRole('columnheader')
					.map((header) => header.textContent?.trim()),
			).toEqual([rowLabel, xLabel]);
		},
	);

	it('preserves a focused row link while value and structural updates stay finite', async () => {
		const initial = baseSpec('95% CI');
		const view = renderReadyMark(initial);
		await rowOverlay(view.container);
		const link = within(view.container.querySelector('table')!).getByRole('link', {
			name: 'Stop One',
		});
		link.focus();
		expect(link).toHaveFocus();

		await view.rerender({
			spec: {
				...initial,
				rows: [{ ...initial.rows[0], value: 57, wilsonLo: 43, wilsonHi: 68 }],
			},
		});
		expect(link).toHaveFocus();
		expect(cell(view.container)).toContain('57%');

		await view.rerender({
			spec: {
				...initial,
				domain: [0, 200],
				rows: [
					{ key: 'new', label: 'New row', value: null, severity: 'watch' },
					{
						...initial.rows[0],
						label: 'Stop One renamed',
						value: 140,
						severity: 'critical',
					},
				],
			},
		});

		await waitFor(() => {
			const bars = [
				...view.container.querySelectorAll<SVGRectElement>(
					'rect.dv-barmark-watch, rect.dv-barmark-high, rect.dv-barmark-critical',
				),
			];
			expect(bars).toHaveLength(1);
			for (const bar of bars)
				for (const attribute of ['x', 'y', 'width', 'height'])
					expect(bar.getAttribute(attribute) ?? '').not.toMatch(/NaN|Infinity/u);
		});
		expect(link).toHaveFocus();
		expect(link).toHaveTextContent('Stop One renamed');
	});

	it('moves focus to the stable chart entry when a focused plotted row is replaced', async () => {
		const initial = baseSpec('95% CI', true);
		const view = renderReadyMark(initial);
		await rowOverlay(view.container);
		const figure = view.container.querySelector('figure') as HTMLElement;
		const target = within(figure).getByRole('button', { name: 'Stop One' });
		target.focus();
		expect(target).toHaveFocus();

		await view.rerender({ spec: { ...initial, domain: [0, 200] } });
		expect(figure).toHaveFocus();
		expect(target).not.toBeInTheDocument();
	});

	it('closes an open row dialog and retains focus when its plotted row is remounted', async () => {
		const initial = baseSpec('95% CI', true);
		const view = renderReadyMark(initial);
		await rowOverlay(view.container);
		const figure = view.container.querySelector('figure') as HTMLElement;
		const target = within(figure).getByRole('button', { name: 'Stop One' });
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		const dialog = await screen.findByRole('dialog', { name: 'Stop One' });
		await waitFor(() => expect(dialog).toHaveFocus());

		await view.rerender({ spec: { ...initial, domain: [0, 200] } });

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(target).not.toBeInTheDocument();
		expect(figure).toHaveFocus();
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(figure).toHaveFocus();
	});

	it('keeps the chart entry focusable when an open row loses its final action', async () => {
		const initial = baseSpec('95% CI', true);
		const view = renderReadyMark(initial);
		await rowOverlay(view.container);
		const figure = view.container.querySelector('figure') as HTMLElement;
		const target = within(figure).getByRole('button', { name: 'Stop One' });
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		const dialog = await screen.findByRole('dialog', { name: 'Stop One' });
		await waitFor(() => expect(dialog).toHaveFocus());

		await view.rerender({
			spec: {
				...initial,
				rows: [{ key: 'empty', label: 'No linked row', value: null, severity: 'watch' }],
			},
		});

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(figure).toHaveAttribute('tabindex', '-1');
		expect(figure).toHaveFocus();
	});

	it('leaves unrelated focus in place when row actions change', async () => {
		const initial = baseSpec('95% CI', true);
		const view = renderReadyMark(initial);
		await rowOverlay(view.container);
		const figure = view.container.querySelector('figure') as HTMLElement;
		const target = within(figure).getByRole('button', { name: 'Stop One' });
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		expect(await screen.findByRole('dialog', { name: 'Stop One' })).toBeInTheDocument();

		const outside = document.createElement('button');
		view.container.append(outside);
		outside.focus();
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		await view.rerender({
			spec: {
				...initial,
				rows: [{ key: 'empty', label: 'No linked row', value: null, severity: 'watch' }],
			},
		});

		expect(outside).toHaveFocus();
		expect(figure).not.toHaveFocus();
	});
});

describe('MagnitudeBarsMark — categorical row identity', () => {
	it('places distinct keyed rows with the same display name on separate bands', async () => {
		const spec: MagnitudeBarsSpec = {
			...baseSpec('95% CI'),
			rows: [
				rowWithCi,
				{
					...rowWithCi,
					key: 's2',
					value: 55,
					severity: 'critical',
					wilsonLo: 42,
					wilsonHi: 65,
					href: '/stop/s2',
				},
			],
		};
		const { container } = renderReadyMark(spec);
		await rowOverlay(container);
		const bars = [
			...container.querySelectorAll<SVGRectElement>(
				'rect.dv-barmark-high, rect.dv-barmark-critical',
			),
		];
		expect(bars).toHaveLength(2);
		expect(new Set(bars.map((bar) => bar.getAttribute('y'))).size).toBe(2);

		const chartLinks = [
			...container.querySelectorAll<SVGAElement>('svg a[href="/stop/s1"], svg a[href="/stop/s2"]'),
		];
		expect(chartLinks).toHaveLength(2);
		expect(
			new Set(chartLinks.map((link) => link.querySelector('rect')?.getAttribute('y'))).size,
		).toBe(2);
		const whiskers = [...container.querySelectorAll<SVGGElement>('g[data-slot="ci-whisker"]')];
		expect(whiskers).toHaveLength(2);
		expect(new Set(whiskers.map((g) => g.querySelector('line')?.getAttribute('y1'))).size).toBe(2);

		const overlays = [...container.querySelectorAll<SVGRectElement>('rect.lc-tooltip-rect')];
		expect(new Set(overlays.map((rect) => rect.getAttribute('y'))).size).toBe(2);
		for (const overlay of new Map(
			overlays.map((rect) => [rect.getAttribute('y'), rect]),
		).values()) {
			await pointerClick(overlay, 'mouse');
		}
		expect(navigate).toHaveBeenCalledTimes(2);
		expect(new Set(navigate.mock.calls.map(([href]) => href))).toEqual(
			new Set(['/stop/s1', '/stop/s2']),
		);
		const ticks = [...container.querySelectorAll<SVGTextElement>('svg text')].map((tick) =>
			tick.textContent?.trim(),
		);
		expect(ticks.filter((label) => label === 'Stop One')).toHaveLength(2);
	});
});

describe('MagnitudeBarsMark — touch datum popover integration', () => {
	it.each(['Enter', ' '])(
		'opens complete row evidence with %s and restores focus on Escape',
		async (key) => {
			const { container } = renderReadyMark(baseSpec('95% CI', true));
			await rowOverlay(container);
			const figure = container.querySelector('figure') as HTMLElement;
			const target = within(figure).getByRole('button', { name: 'Stop One' });
			const row = target.querySelector('rect') as SVGRectElement;
			expect(target.closest('svg')).toBeInTheDocument();
			expect(Number(row.getAttribute('width'))).toBeGreaterThan(0);
			expect(Number(row.getAttribute('height'))).toBeGreaterThan(0);
			expect(
				within(figure.querySelector('table')!).getByRole('link', { name: 'Stop One' }),
			).toHaveAttribute('tabindex', '-1');

			target.focus();
			expect(target).toHaveFocus();
			await fireEvent.keyDown(target, { key });

			const dialog = await screen.findByRole('dialog', { name: 'Stop One' });
			await waitFor(() => expect(dialog).toHaveFocus());
			expect(within(dialog).getByText('44%')).toBeInTheDocument();
			expect(within(dialog).getByText('31%–57%')).toBeInTheDocument();
			expect(
				within(dialog).getByRole('link', { name: 'View detail for Stop One' }),
			).toHaveAttribute('href', '/stop/s1');
			expect(navigate).not.toHaveBeenCalled();

			await fireEvent.keyDown(document, { key: 'Escape' });
			await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
			expect(target).toHaveFocus();
			expect(figure).not.toHaveAttribute('aria-controls');
		},
	);

	it('replaces an active mouse tooltip with the keyboard datum dialog', async () => {
		const { container } = renderReadyMark(baseSpec('95% CI', true));
		const overlay = await rowOverlay(container);
		await fireEvent.pointerEnter(overlay, {
			pointerType: 'mouse',
			clientX: 120,
			clientY: 240,
		});
		await waitFor(() => expect(document.querySelector('.lc-tooltip-root')).toBeInTheDocument());

		const target = within(container.querySelector('figure')!).getByRole('button', {
			name: 'Stop One',
		});
		expect(target).toHaveAttribute('aria-haspopup', 'dialog');
		expect(target).toHaveAttribute('aria-expanded', 'false');
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });

		const dialog = await screen.findByRole('dialog', { name: 'Stop One' });
		expect(document.querySelector('.lc-tooltip-root')).not.toBeInTheDocument();
		expect(target).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(target).toHaveAttribute('aria-expanded', 'false');
		expect(dialog).not.toBeInTheDocument();
	});

	it('opens row evidence when the plotted button itself receives a direct click', async () => {
		const { container } = renderReadyMark(baseSpec('95% CI', true));
		await rowOverlay(container);
		const target = within(container.querySelector('figure')!).getByRole('button', {
			name: 'Stop One',
		});

		await fireEvent.click(target);

		const dialog = await screen.findByRole('dialog', { name: 'Stop One' });
		expect(within(dialog).getByText('31%–57%')).toBeInTheDocument();
		expect(navigate).not.toHaveBeenCalled();
	});

	it('offers a visible native link for a row without a popover', async () => {
		const { container } = renderReadyMark(baseSpec('95% CI'));
		await rowOverlay(container);
		const figure = container.querySelector('figure') as HTMLElement;
		const plotLink = figure.querySelector('svg a[href="/stop/s1"]') as SVGAElement;
		expect(plotLink).toBeInTheDocument();
		expect(plotLink).toHaveAccessibleName('Stop One');
		expect(plotLink.querySelector('rect')).toBeInTheDocument();
		expect(
			within(figure.querySelector('table')!).getByRole('link', { name: 'Stop One' }),
		).toHaveAttribute('tabindex', '-1');
	});

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
		const figure = container.querySelector('figure') as HTMLElement;

		await pointerClick(await rowOverlay(container), 'touch');

		const dialogs = await screen.findAllByRole('dialog', { name: 'Stop One' });
		expect(dialogs).toHaveLength(1);
		await waitFor(() => expect(dialogs[0]).toHaveFocus());
		expect(figure).toHaveAttribute('aria-controls', dialogs[0].id);
		expect(navigate).not.toHaveBeenCalled();

		await fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(figure).toHaveFocus();
		expect(figure).not.toHaveAttribute('aria-controls');
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
		expect(within(hover).getByText('31%–57%')).toBeInTheDocument();
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
