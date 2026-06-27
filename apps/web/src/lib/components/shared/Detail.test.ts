// Detail.test.ts — the lightweight "Show the detail" progressive-disclosure
// expander. Covers the contract every rider-question section depends on: closed
// by default, the trigger is a real aria-expanded button (not a link), the label
// flips on open (with a fallback), and the detail children render in the body.

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Detail from './Detail.svelte';

const body = createRawSnippet(() => ({
	render: () => `<p data-testid="detail-content">Analyst detail</p>`,
}));

describe('Detail', () => {
	it('renders the collapsed label and is closed by default', () => {
		const { container, getByText } = render(Detail, {
			props: { label: 'Show the detail', children: body },
		});
		expect(getByText('Show the detail')).toBeTruthy();
		const toggle = container.querySelector('[data-slot="detail-toggle"]');
		expect(toggle?.getAttribute('aria-expanded')).toBe('false');
	});

	it('exposes a real <button> as the disclosure trigger, not a link', () => {
		const { container } = render(Detail, { props: { label: 'More', children: body } });
		const toggle = container.querySelector('button[data-slot="detail-toggle"]');
		expect(toggle).toBeTruthy();
		expect(toggle?.tagName).toBe('BUTTON');
		expect(container.querySelector('a[data-slot="detail-toggle"]')).toBeNull();
	});

	it('opens on click and flips to the open label', async () => {
		const { container, getByText } = render(Detail, {
			props: { label: 'Show the detail', labelOpen: 'Hide the detail', children: body },
		});
		const toggle = container.querySelector('[data-slot="detail-toggle"]') as HTMLElement;
		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(getByText('Hide the detail')).toBeTruthy();
	});

	it('falls back to the collapsed label when labelOpen is omitted', async () => {
		const { container, getByText } = render(Detail, {
			props: { label: 'Show the detail', children: body },
		});
		const toggle = container.querySelector('[data-slot="detail-toggle"]') as HTMLElement;
		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(getByText('Show the detail')).toBeTruthy();
	});

	it('renders the detail children inside the disclosure body', () => {
		const { getByTestId } = render(Detail, {
			props: { label: 'Show the detail', open: true, children: body },
		});
		expect(getByTestId('detail-content')).toBeTruthy();
	});

	it('respects a bound open=true on first render', () => {
		const { container } = render(Detail, {
			props: { label: 'Show the detail', open: true, children: body },
		});
		const toggle = container.querySelector('[data-slot="detail-toggle"]');
		expect(toggle?.getAttribute('aria-expanded')).toBe('true');
	});
});
