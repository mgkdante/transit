import { fireEvent, render } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import ReleaseContract from './__fixtures__/ReleaseContract.svelte';

it('keeps prose and actions open; only the heading toggles, with a persistent summary', async () => {
	const view = render(ReleaseContract);
	const heading = view.getByRole('button', { name: /Reading/ });
	if (heading.getAttribute('aria-expanded') !== 'true') await fireEvent.click(heading);
	await fireEvent.click(view.getByText('Read this body without closing it.'));
	expect(heading).toHaveAttribute('aria-expanded', 'true');
	await fireEvent.click(view.getByRole('button', { name: 'Section action' }));
	expect(heading).toHaveAttribute('aria-expanded', 'true');
	await fireEvent.click(heading);
	expect(heading).toHaveAttribute('aria-expanded', 'false');
	expect(view.getByText('Finding, period and hedge remain readable.')).toBeVisible();
});

it('orders the signpost English then French even when supplied in reverse', () => {
	const view = render(ReleaseContract);
	expect(view.getByTestId('language-toggle')).toHaveTextContent(/EN.*FR/);
});

it('allows the shared focus outline by omitting the outline suppression class', () => {
	const view = render(ReleaseContract);
	expect(view.getByRole('button', { name: 'Section action' })).not.toHaveClass('outline-none');
});
