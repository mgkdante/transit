import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import CollapsibleDatavizHarness from './__fixtures__/CollapsibleDatavizHarness.svelte';

function renderHarness() {
	const view = render(CollapsibleDatavizHarness);
	const trigger = view.container.querySelector('button[data-section-trigger]') as HTMLButtonElement;
	return { ...view, trigger };
}

describe('CollapsibleSection data-visualization interaction boundary', () => {
	it('does not toggle when a chart legend is clicked', async () => {
		const { container, trigger } = renderHarness();
		const legendItem = container.querySelector('[data-slot="stacked-share-mark"] li');

		expect(legendItem).not.toBeNull();
		await fireEvent.click(legendItem!);
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
	});

	it('does not toggle when a standalone shared chart legend is clicked', async () => {
		const { getByTestId, trigger } = renderHarness();
		const legendItem = getByTestId('standalone-chart-legend').querySelector('li');

		expect(legendItem).not.toBeNull();
		await fireEvent.click(legendItem!);
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
	});

	it('does not toggle when a visual severity bar or tooltip trigger is clicked', async () => {
		const { container, trigger } = renderHarness();
		const bar = container.querySelector('[data-slot="severity-bar"]');

		expect(bar).not.toBeNull();
		await fireEvent.click(bar!);
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
	});

	it('does not toggle when the chart scroller is clicked', async () => {
		const { container, trigger } = renderHarness();
		const scroller = container.querySelector('[data-slot="scroll-frame-scroller"]');

		expect(scroller).not.toBeNull();
		await fireEvent.click(scroller!);
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
	});

	it('still toggles when plain card-body prose is clicked', async () => {
		const { getByTestId, trigger } = renderHarness();

		await fireEvent.click(getByTestId('plain-card-prose'));
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
	});
});
