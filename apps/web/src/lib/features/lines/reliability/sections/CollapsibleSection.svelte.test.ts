import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import Harness from './__fixtures__/CollapsibleSectionQuietModeHarness.svelte';

function sectionToggle(container: HTMLElement, dataSection = 'when-to-ride'): HTMLButtonElement {
	const toggle = container.querySelector<HTMLButtonElement>(
		`[data-section="${dataSection}"] [data-section-trigger]`,
	);
	if (!toggle) throw new Error('Reliability section toggle did not render');
	return toggle;
}

function sectionToggles(container: HTMLElement): HTMLButtonElement[] {
	return [
		...container.querySelectorAll<HTMLButtonElement>('[data-section] [data-section-trigger]'),
	];
}

beforeEach(() => {
	quietModeStore.resetForTest();
});

afterEach(() => {
	quietModeStore.resetForTest();
});

describe('reliability CollapsibleSection quiet-mode integration', () => {
	it('renders every rider question through the shared article-summary card', async () => {
		const { container } = render(Harness);
		const section = container.querySelector('[data-section="when-to-ride"]');
		const card = section?.querySelector('[data-slot="card"]');
		const heading = section?.querySelector('h2.section-heading');
		const toggle = sectionToggle(container);

		expect(card).toHaveAttribute('data-header-variant', 'article-summary');
		expect(card).toHaveClass('section-card--article-summary');
		expect(heading?.firstElementChild).toBe(toggle);
		expect(toggle).toHaveAccessibleName('WHEN TO RIDE');
		expect(toggle).toHaveAccessibleDescription('When should I take this line?');
		expect(toggle.querySelector('[data-slot="badge"]')).toHaveTextContent('02');
		expect(card?.querySelector('.section-subtitle--article-summary')).toHaveTextContent(
			'When should I take this line?',
		);
		const headingRow = card?.querySelector('.section-heading-row');
		const chevron = headingRow?.querySelector('[data-slot="chevron-toggle"]');
		expect(toggle.querySelector('[data-slot="chevron-toggle"]')).toBeNull();
		expect(headingRow?.lastElementChild).toContainElement(chevron as HTMLElement);
		expect(headingRow?.lastElementChild).toHaveClass('section-header__chevron');
		expect(toggle).toHaveAttribute('aria-expanded', 'true');

		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'true');
	});

	it('responds to the real Collapse all and Expand all control', async () => {
		const { container } = render(Harness);
		const toggles = sectionToggles(container);

		expect(toggles).toHaveLength(5);
		for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		await waitFor(() => {
			for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded', 'false');
		});
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Expand all');

		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		await waitFor(() => {
			for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded', 'true');
		});
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Collapse all');
	});

	it('Always start collapsed recloses an individually reopened section and stores the preference', async () => {
		const { container } = render(Harness);
		const toggles = sectionToggles(container);
		const reopened = sectionToggle(container, 'run-and-fit');

		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		await waitFor(() => expect(reopened).toHaveAttribute('aria-expanded', 'false'));
		await fireEvent.click(reopened);
		expect(reopened).toHaveAttribute('aria-expanded', 'true');

		await fireEvent.click(screen.getByTestId('quiet-mode-remember'));

		await waitFor(() => {
			for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded', 'false');
		});
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');
	});

	it('reapplies the remembered collapsed default after a full remount', async () => {
		const first = render(Harness);
		const firstToggle = sectionToggle(first.container);

		await fireEvent.click(screen.getByTestId('quiet-mode-remember'));
		await waitFor(() => expect(firstToggle).toHaveAttribute('aria-expanded', 'false'));
		await fireEvent.click(firstToggle);
		expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');

		first.unmount();
		const second = render(Harness);
		const secondToggles = sectionToggles(second.container);

		await waitFor(() => {
			for (const toggle of secondToggles) expect(toggle).toHaveAttribute('aria-expanded', 'false');
		});
		expect(secondToggles).toHaveLength(5);
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Expand all');
	});
});
