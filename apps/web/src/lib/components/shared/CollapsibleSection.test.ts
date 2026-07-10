// CollapsibleSection.test.ts - the reusable collapsible section card.
//
// Ported from yesid.dev's gate (quiet-mode cases dropped: transit has no
// quiet-mode store). Covers: title + children, numbered badge, toggle, the
// non-collapsible (static) variant, accent CSS var, the data-toc anchor the
// shared TOC scrolls to, and the whole-card toggle contract (interactive
// children never toggle; the header stays the semantic aria-expanded button).

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import CollapsibleSection from './CollapsibleSection.svelte';

const bodyContent = createRawSnippet(() => ({
	render: () => `<div>
		<p data-testid="body-text">Plain prose body</p>
		<button type="button" data-testid="body-button">Child action</button>
		<span role="button" tabindex="0" data-testid="body-rolebutton">Faux button</span>
		<a href="/lines" data-testid="body-link">Child link</a>
	</div>`,
}));

describe('CollapsibleSection', () => {
	it('renders title and children when open', () => {
		const { getByText } = render(CollapsibleSection, {
			props: { title: 'Overview', open: true },
		});
		expect(getByText('Overview')).toBeTruthy();
	});

	it('renders a zero-padded numbered badge when index is provided', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Step', open: true, index: 0 },
		});
		const badge = container.querySelector('[data-slot="badge"]');
		expect(badge?.textContent?.trim()).toBe('01');
	});

	it('toggles body visibility on header click when collapsible', async () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Test', open: true, collapsible: true },
		});
		const button = container.querySelector('button.section-header');
		expect(button).toBeTruthy();
		const body = container.querySelector('.section-body');
		expect(body?.getAttribute('data-state')).toBe('open');
		await fireEvent.click(button!);
		expect(body?.getAttribute('data-state')).toBe('closed');
	});

	it('renders as a static div (not a button) when collapsible is false', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Static', open: true, collapsible: false },
		});
		expect(container.querySelector('button.section-header')).toBeNull();
	});

	it('sets the accent color as a --accent CSS custom property', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Amber', open: true, accentColor: 'var(--accent-text)' },
		});
		const card = container.querySelector('.section-card') as HTMLElement;
		expect(card.style.getPropertyValue('--accent')).toBe('var(--accent-text)');
	});

	it('emits the data-toc anchor so the shared TOC can target it', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Anchored', open: true, anchor: 'overview' },
		});
		const card = container.querySelector('.section-card') as HTMLElement;
		expect(card.getAttribute('data-toc')).toBe('overview');
	});
});

describe('CollapsibleSection - whole-card toggling', () => {
	it('toggles from a click on the non-interactive card body', async () => {
		const { container, getByTestId } = render(CollapsibleSection, {
			props: { title: 'Card', open: true, children: bodyContent },
		});
		const body = container.querySelector('.section-body');
		expect(body?.getAttribute('data-state')).toBe('open');

		await fireEvent.click(getByTestId('body-text'));
		expect(body?.getAttribute('data-state')).toBe('closed');

		const card = container.querySelector('[data-slot="card"]') as HTMLElement;
		await fireEvent.click(card);
		expect(body?.getAttribute('data-state')).toBe('open');
	});

	it('clicks originating from interactive children never toggle', async () => {
		const { container, getByTestId } = render(CollapsibleSection, {
			props: { title: 'Card', open: true, children: bodyContent },
		});
		const body = container.querySelector('.section-body');
		expect(body?.getAttribute('data-state')).toBe('open');

		await fireEvent.click(getByTestId('body-button'));
		expect(body?.getAttribute('data-state')).toBe('open');

		await fireEvent.click(getByTestId('body-rolebutton'));
		expect(body?.getAttribute('data-state')).toBe('open');
	});

	it('header click toggles exactly once (card handler must not re-toggle it)', async () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Card', open: true, children: bodyContent },
		});
		const header = container.querySelector('button.section-header') as HTMLElement;
		const body = container.querySelector('.section-body');

		await fireEvent.click(header);
		expect(body?.getAttribute('data-state')).toBe('closed');
		await fireEvent.click(header);
		expect(body?.getAttribute('data-state')).toBe('open');
	});

	it('keeps the header as the real aria-expanded button; the card claims no role', async () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Card', open: true, children: bodyContent },
		});
		const header = container.querySelector('button.section-header') as HTMLElement;
		expect(header).toBeTruthy();
		expect(header.getAttribute('aria-expanded')).toBe('true');

		await fireEvent.click(header);
		expect(header.getAttribute('aria-expanded')).toBe('false');

		const card = container.querySelector('[data-slot="card"]') as HTMLElement;
		expect(card.getAttribute('role')).toBeNull();
		expect(card.classList.contains('section-card--toggleable')).toBe(true);
	});

	it('non-collapsible cards opt out of the whole-card affordance', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Static', open: true, collapsible: false, children: bodyContent },
		});
		const card = container.querySelector('[data-slot="card"]') as HTMLElement;
		expect(card.classList.contains('section-card--toggleable')).toBe(false);
	});
});

describe('CollapsibleSection - mount-time bulk mode', () => {
	// Data-gated cards mount AFTER the article's mount-time bulk signal bumped the
	// counters, so the edge-detectors never see a change. `bulkCollapsed` carries
	// the page's current bulk mode; on mount it is authoritative over the `open`
	// default and any restored session choice (state model #8/#10).

	it('adopts a collapsed bulk mode when mounting after the close signal fired', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Late', open: true, closeSignal: 1, openSignal: 0, bulkCollapsed: true },
		});
		expect(container.querySelector('.section-body')?.getAttribute('data-state')).toBe('closed');
	});

	it('reopens a stale session CLOSE choice when the mount-time bulk mode is expanded', () => {
		sessionStorage.setItem('transit.persisted:late-card', 'false');
		try {
			const { container } = render(CollapsibleSection, {
				props: {
					title: 'Late',
					open: true,
					sectionKey: 'late-card',
					closeSignal: 0,
					openSignal: 1,
					bulkCollapsed: false,
				},
			});
			expect(container.querySelector('.section-body')?.getAttribute('data-state')).toBe('open');
		} finally {
			sessionStorage.removeItem('transit.persisted:late-card');
		}
	});

	it('stays session-restored when no bulk mode is wired (signal-inert default)', () => {
		sessionStorage.setItem('transit.persisted:late-card-inert', 'false');
		try {
			const { container } = render(CollapsibleSection, {
				props: { title: 'Late', open: true, sectionKey: 'late-card-inert' },
			});
			expect(container.querySelector('.section-body')?.getAttribute('data-state')).toBe('closed');
		} finally {
			sessionStorage.removeItem('transit.persisted:late-card-inert');
		}
	});

	it('uses bulkCollapsed only at mount and preserves later manual state', async () => {
		try {
			const { container, rerender } = render(CollapsibleSection, {
				props: {
					title: 'Late',
					open: true,
					sectionKey: 'late-card-one-shot',
					bulkCollapsed: true,
				},
			});
			const header = container.querySelector('button.section-header') as HTMLElement;
			const body = container.querySelector('.section-body');
			expect(body).toHaveAttribute('data-state', 'closed');

			await fireEvent.click(header);
			await fireEvent.click(header);
			expect(body).toHaveAttribute('data-state', 'closed');

			await rerender({
				title: 'Late',
				open: true,
				sectionKey: 'late-card-one-shot',
				bulkCollapsed: false,
			});
			expect(body).toHaveAttribute('data-state', 'closed');
		} finally {
			sessionStorage.removeItem('transit.persisted:late-card-one-shot');
		}
	});
});
