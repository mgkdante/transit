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
		expect(getByText(/SEC\s*1\s*\/\s*3/)).toBeTruthy();
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

	// slice-9.7 A2: the ToC rail is NON-hideable. It must never expose a user
	// affordance that collapses/persists it closed (quiet/focus mode collapses the
	// section CARDS, not the navigation). The heading renders as a plain header,
	// NOT a disclosure trigger, so a reader can never hide the ToC and a
	// previously-collapsed ToC has no persisted state to restore.
	it('is non-hideable: the heading is a plain header with no disclosure trigger', () => {
		const { container, getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
			},
		});

		// The heading itself carries no toggle: it is not (nor inside) a collapsible
		// disclosure trigger, and there is no chevron to flip it shut.
		const headingEl = getByText('On this page');
		expect(headingEl.closest('[data-slot="collapsible-trigger"]')).toBeNull();
		expect(container.querySelector('[data-slot="collapsible-trigger"]')).toBeNull();

		// The nav (and its jump buttons) is always mounted + reachable: the only
		// buttons present are the entry jump buttons, never a header toggle.
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
