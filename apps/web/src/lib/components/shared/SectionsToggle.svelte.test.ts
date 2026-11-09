import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Harness from './__fixtures__/SectionsToggleHarness.svelte';

afterEach(() => {
	localStorage.clear();
	delete document.documentElement.dataset.sectionsChoice;
});

const localeContext = (locale: 'en' | 'fr') =>
	new Map([[Symbol.for('@yesid/ui/locale'), () => locale]]);

describe('SectionsToggle consumer integration', () => {
	it.each([0, 1])('hides below two content sections (%s), excluding filters and TOC', (count) => {
		render(Harness, { props: { count }, context: localeContext('en') });
		expect(screen.getByTestId('sections-controls')).toHaveAttribute('data-sections-hidden');
	});
	it.each([
		['en', 'Collapse all', 'Expand all'],
		['fr', 'Tout replier', 'Tout déplier'],
	] as const)(
		'%s: mixed state collapses everything, while filters keep their own state',
		async (locale, collapse, expand) => {
			render(Harness, { context: localeContext(locale) });
			const first = screen.getByRole('button', { name: 'Section 1' });
			const second = screen.getByRole('button', { name: 'Section 2' });
			const filters = screen.getByRole('button', { name: 'Filters' });
			expect(first).toHaveAttribute('aria-expanded', 'true');
			expect(second).toHaveAttribute('aria-expanded', 'false');
			expect(screen.getByTestId('sections-controls').querySelectorAll('button')).toHaveLength(1);
			await fireEvent.click(screen.getByRole('button', { name: collapse }));
			expect(first).toHaveAttribute('aria-expanded', 'false');
			expect(second).toHaveAttribute('aria-expanded', 'false');
			expect(filters).toHaveAttribute('aria-expanded', 'true');
			await fireEvent.click(screen.getByRole('button', { name: expand }));
			expect(first).toHaveAttribute('aria-expanded', 'true');
			expect(second).toHaveAttribute('aria-expanded', 'true');
		},
	);
});
