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
				sectionKey: 'toc-test',
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
				sectionKey: 'toc-test',
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
				sectionKey: 'toc-test',
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
				sectionKey: 'toc-test',
			},
		});
		await fireEvent.click(getByText('Reliability'));
		expect(onNavigate).toHaveBeenCalledWith('reliability');
	});
});
