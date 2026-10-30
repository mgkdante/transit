import { fireEvent, render, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { alertHistoryCopy } from '../alerts.copy';
import AlertFilters from './AlertFilters.svelte';

function props(overrides: Record<string, unknown> = {}) {
	return {
		affects: 'all',
		severity: 'all',
		route: null,
		stop: null,
		window: { from: '2026-06-01', to: '2026-06-30' },
		lineOptions: [],
		stopOptions: [],
		availableDates: ['2026-01-01', '2026-07-13'],
		filtersActive: false,
		matchCount: 2,
		copy: alertHistoryCopy.en,
		locale: 'en',
		historyCoverageText: 'Archive coverage: Jan 1 to Jul 13, 2026',
		historySelectionText: 'Selected: Jun 1 to Jun 30, 2026',
		historyAnnouncement: null,
		onWindowChange: vi.fn(),
		onClear: vi.fn(),
		...overrides,
	};
}

describe('AlertFilters history composition', () => {
	it('uses the shared control stack with history first and joined primary filters', () => {
		const { container } = render(AlertFilters, {
			props: props() as never,
		});

		const stack = container.querySelector('[data-slot="article-control-stack"]');
		expect(stack).not.toBeNull();
		expect(
			Array.from(stack?.children ?? []).map((region) => region.getAttribute('data-region')),
		).toEqual(['history', 'primary', 'secondary']);

		const history = container.querySelector('[data-slot="window-pick"]') as HTMLElement;
		const affects = within(container).getByText('Affects');
		expect(history).not.toBeNull();
		expect(history.compareDocumentPosition(affects) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

		const joinedGroups = container.querySelectorAll(
			'[data-region="primary"] [data-slot="segmented-choice"][data-variant="joined-grid"]',
		);
		expect(joinedGroups).toHaveLength(2);
		expect(joinedGroups[0]).toHaveAttribute('data-segment-count', '3');
		expect(joinedGroups[1]).toHaveAttribute('data-segment-count', '4');
	});

	it('maps All to the unfiltered state', async () => {
		const { container } = render(AlertFilters, { props: props({ affects: 'stops' }) as never });
		const group = within(container).getByRole('radiogroup', { name: 'Affects' });

		await fireEvent.click(within(group).getByRole('radio', { name: 'All' }));

		expect(within(group).getByRole('radio', { name: 'All' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
	});

	it.each([
		{
			mode: 'pointer click',
			activate: async (target: HTMLElement) => {
				await fireEvent.click(target, { detail: 1 });
			},
		},
		{
			mode: 'keyboard-style native button activation',
			activate: async (target: HTMLElement) => {
				await fireEvent.keyDown(target, { key: 'Enter' });
				await fireEvent.click(target, { detail: 0 });
				await fireEvent.keyUp(target, { key: 'Enter' });
			},
		},
	])('clears a repeated active choice via $mode', async ({ activate }) => {
		const { container } = render(AlertFilters, { props: props({ severity: 'high' }) as never });
		const group = within(container).getByRole('radiogroup', { name: 'Severity' });
		const active = within(group)
			.getAllByRole('radio')
			.find((r) => r.getAttribute('aria-checked') === 'true');
		expect(active).not.toHaveTextContent('All');

		await activate(active as HTMLElement);

		expect(within(group).getByRole('radio', { name: 'All' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
	});

	it('uses one controlled HistoryNavigator and forwards a normalized complete range', async () => {
		const onWindowChange = vi.fn();
		const view = render(AlertFilters, {
			props: props({ onWindowChange }) as never,
		});
		const { container } = view;
		const navigator = container.querySelector('[data-slot="history-navigator"]') as HTMLElement;

		expect(navigator).not.toBeNull();
		expect(container.querySelectorAll('[data-slot="history-navigator"]')).toHaveLength(1);
		expect(
			within(navigator).getByText('Archive coverage: Jan 1 to Jul 13, 2026'),
		).toBeInTheDocument();
		expect(within(navigator).getByText('Selected: Jun 1 to Jun 30, 2026')).toBeInTheDocument();

		await fireEvent.change(within(navigator).getByLabelText('Alert history range · From'), {
			target: { value: '2026-05-01' },
		});
		await view.rerender(
			props({
				onWindowChange,
				window: { from: '2026-05-01', to: '2026-06-30' },
			}) as never,
		);
		await fireEvent.change(within(navigator).getByLabelText('Alert history range · To'), {
			target: { value: '2026-05-31' },
		});
		expect(onWindowChange).toHaveBeenLastCalledWith({
			from: '2026-05-01',
			to: '2026-05-31',
		});
	});
});
