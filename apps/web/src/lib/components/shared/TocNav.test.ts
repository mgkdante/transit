// TocNav.test.ts - the desktop table-of-contents card.
//
// Gates: it renders every non-rail entry as a nav button (rail entries are
// excluded; they live in the desktop side rail), marks the active entry with
// aria-current, renders the "SEC N / total" counter, and calls onNavigate with
// the clicked entry id.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TocNav from './TocNav.svelte';
import type { TocEntry } from './toc';

const entries: TocEntry[] = [
	{
		id: 'overview',
		title: 'Overview',
		level: 2,
		badge: { kind: 'icon', name: 'eye' },
		children: [],
	},
	{
		id: 'reliability',
		title: 'Reliability',
		level: 2,
		badge: { kind: 'number', value: 1 },
		children: [{ id: 'on-time', title: 'On time', level: 3, children: [] }],
	},
	{ id: 'sources', title: 'Sources', level: 2, rail: true, children: [] },
];

describe('TocNav', () => {
	it('renders the heading and one button per non-rail entry (+ sub-items)', () => {
		const { getByText, queryByText, container } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
			},
		});
		expect(getByText('On this page')).toBeTruthy();
		expect(getByText('Overview')).toBeTruthy();
		expect(getByText('Reliability')).toBeTruthy();
		expect(getByText('On time')).toBeTruthy();
		// rail:true entry is excluded from the desktop nav.
		expect(queryByText('Sources')).toBeNull();
		expect(container.querySelectorAll('.toc-item').length).toBe(3); // 2 parents + 1 sub
	});

	it('marks the active entry with aria-current="location"', () => {
		const { getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'reliability',
				onNavigate: () => {},
				heading: 'On this page',
			},
		});
		const active = getByText('Reliability').closest('button');
		expect(active?.getAttribute('aria-current')).toBe('location');
	});

	it('renders the counter prefix + position', () => {
		const { getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
				counterPrefix: 'SEC',
			},
		});
		// 3 flattened non-rail entries (overview, reliability, on-time); overview is #1.
		// Zero-padded to match the numbered section chips (P5.4f: this footer counter is
		// the rail's ONE position readout — SectionProgress was retired).
		expect(getByText(/SEC\s*01\s*\/\s*03/)).toBeTruthy();
	});

	it('calls onNavigate with the entry id on click', async () => {
		const onNavigate = vi.fn();
		const { getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate,
				heading: 'On this page',
			},
		});
		await fireEvent.click(getByText('Reliability'));
		expect(onNavigate).toHaveBeenCalledWith('reliability');
	});

	// slice-9.8-B: the ToC rail is USER-COLLAPSIBLE by default — it owns its own
	// collapse affordance (a header disclosure trigger / chevron). This is the
	// reader's own toggle, DISTINCT from FOCUS/quiet (which collapses the section
	// CARDS, never the ToC). The page must never wire this toggle to its quiet
	// state; here we just assert the affordance exists and folds the nav.
	it('is user-collapsible by default: the heading is a disclosure trigger that folds the nav', async () => {
		const { container, getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
			},
		});

		// The heading IS a collapsible disclosure trigger (its own chevron toggle).
		const headingEl = getByText('On this page');
		const trigger = headingEl.closest('[data-slot="collapsible-trigger"]');
		expect(trigger).not.toBeNull();

		// Open by default: the nav + its jump buttons are mounted and reachable.
		const nav = container.querySelector('nav.toc-nav');
		expect(nav).not.toBeNull();
		expect(container.querySelector('[data-state="open"]')).not.toBeNull();

		// Clicking the trigger folds the rail (the reader's own collapse affordance).
		await fireEvent.click(trigger as HTMLElement);
		expect(container.querySelector('[data-state="closed"]')).not.toBeNull();
	});

	// The non-hideable variant remains available (collapsible={false}): a caller
	// can still opt into a permanently-open rail with no disclosure trigger.
	it('renders a permanently-open, non-hideable rail when collapsible={false}', () => {
		const { container, getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
				collapsible: false,
			},
		});

		const headingEl = getByText('On this page');
		expect(headingEl.closest('[data-slot="collapsible-trigger"]')).toBeNull();
		expect(container.querySelector('[data-slot="collapsible-trigger"]')).toBeNull();

		const nav = container.querySelector('nav.toc-nav');
		expect(nav).not.toBeNull();
		const buttons = container.querySelectorAll('button');
		// Exactly the 3 flattened non-rail jump buttons — no extra toggle button.
		expect(buttons.length).toBe(3);
		for (const btn of buttons) {
			expect(btn.classList.contains('toc-item')).toBe(true);
		}
	});
});
