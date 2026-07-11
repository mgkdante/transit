// TocPill.test.ts - the mobile floating table-of-contents pill + drawer.
//
// Gates: the pill shows the active entry name + counter; its aria-label starts
// with the visible text then appends the purpose (Lighthouse 2.5.3); the drawer
// is closed until the pill is tapped, then lists every entry (rail entries
// included on mobile); tapping an entry resolves + scrolls its target.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TocPill from './TocPill.svelte';
import type { TocEntry } from './toc';

const entries: TocEntry[] = [
	{
		id: 'overview',
		title: 'Overview',
		level: 2,
		badge: { kind: 'icon', name: 'eye' },
		children: [],
	},
	{ id: 'sources', title: 'Sources', level: 2, rail: true, children: [] },
];

const props = {
	entries,
	activeId: 'overview',
	openAria: 'Table of contents',
	closeAria: 'Close table of contents',
};

describe('TocPill', () => {
	it('shows the active entry name + counter and a prefix-matching aria-label', () => {
		const { getByTestId, getByText } = render(TocPill, { props });
		expect(getByText('Overview')).toBeTruthy();
		expect(getByText('1/2')).toBeTruthy();
		const pill = getByTestId('toc-pill').querySelector('.toc-pill') as HTMLElement;
		// Visible text must be a prefix of the accessible name.
		expect(pill.getAttribute('aria-label')).toBe('Overview 1/2 · Table of contents');
	});

	it('shows canonical section numbers for a gapped numbered run', () => {
		const gappedEntries: TocEntry[] = [
			{
				id: 'freshness',
				title: 'Feed freshness',
				level: 2,
				badge: { kind: 'number', value: 2 },
				children: [],
			},
			{
				id: 'envelope',
				title: 'Build accountability',
				level: 2,
				badge: { kind: 'number', value: 8 },
				children: [],
			},
		];
		const { getByTestId, getByText } = render(TocPill, {
			props: { ...props, entries: gappedEntries, activeId: 'freshness' },
		});

		expect(getByText('2/8')).toBeTruthy();
		const pill = getByTestId('toc-pill').querySelector('.toc-pill') as HTMLElement;
		expect(pill.getAttribute('aria-label')).toBe('Feed freshness 2/8 · Table of contents');
	});

	it('opens the drawer on tap and lists every entry (rail included on mobile)', async () => {
		const { getByTestId } = render(TocPill, { props });
		const container = getByTestId('toc-pill');
		expect(container.querySelector('.toc-drawer')).toBeNull();

		const pill = container.querySelector('.toc-pill') as HTMLElement;
		await fireEvent.click(pill);

		const drawer = container.querySelector('.toc-drawer');
		expect(drawer).toBeTruthy();
		expect(drawer?.textContent).toContain('Overview');
		expect(drawer?.textContent).toContain('Sources');
	});

	it('scrolls to a target and closes the drawer when an entry is tapped', async () => {
		const target = document.createElement('section');
		target.setAttribute('data-toc', 'overview');
		target.scrollIntoView = vi.fn();
		document.body.appendChild(target);

		const { getByTestId } = render(TocPill, { props });
		const container = getByTestId('toc-pill');
		await fireEvent.click(container.querySelector('.toc-pill') as HTMLElement);

		const item = container.querySelector('.toc-drawer-item') as HTMLElement;
		await fireEvent.click(item);

		expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
		expect(container.querySelector('.toc-drawer')).toBeNull();

		document.body.removeChild(target);
	});
});
