import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quietMode } from '@yesid/ui/state';
import Harness from './__fixtures__/CollapsibleSectionQuietModeHarness.svelte';

function sectionToggle(container: HTMLElement, dataSection = 'when-to-ride'): HTMLButtonElement {
	const toggle = container.querySelector<HTMLButtonElement>(
		`[data-section="${dataSection}"] [data-section-trigger]`,
	);
	if (!toggle) throw new Error('Reliability section toggle did not render');
	return toggle;
}

beforeEach(() => {
	quietMode.resetForTest();
});

afterEach(() => {
	quietMode.resetForTest();
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
});
