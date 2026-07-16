import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import FilterGroup from './FilterGroup.svelte';

// No i18n provider ⇒ getLocale() returns DEFAULT_LOCALE ('en'), so allLabel resolves
// to its en form. bits-ui ToggleGroup (type=single) renders each item as role=radio
// with aria-checked, so the group is queryable exactly like a radiogroup.

const ITEMS = [
	{ key: 'lines', label: 'Lines' },
	{ key: 'stops', label: 'Stops' },
] as const;

const source = readFileSync(
	resolve(process.cwd(), 'src/lib/components/filter/FilterGroup.svelte'),
	'utf-8',
);

describe('FilterGroup', () => {
	it('keeps the default density compact for alerts and existing callers', () => {
		const { container } = render(FilterGroup, {
			props: { label: 'Affects', items: ITEMS, activeKey: null, onSelect: vi.fn() },
		});
		const all = screen.getByRole('radio', { name: 'All' });
		const item = screen.getByRole('radio', { name: 'Lines' });
		expect(container.firstElementChild).toHaveAttribute('data-density', 'compact');
		for (const button of [all, item]) {
			expect(button).toHaveClass('px-2', 'text-sm');
			expect(button).not.toHaveClass('px-3', 'text-base');
		}
	});

	it('offers an explicit spacious density with larger type and inline padding', () => {
		const { container } = render(FilterGroup, {
			props: {
				label: 'Affects',
				items: ITEMS,
				activeKey: null,
				density: 'spacious',
				onSelect: vi.fn(),
			},
		});
		expect(container.firstElementChild).toHaveAttribute('data-density', 'spacious');
		for (const button of [
			screen.getByRole('radio', { name: 'All' }),
			screen.getByRole('radio', { name: 'Lines' }),
		]) {
			expect(button).toHaveClass('px-3', 'text-base');
			expect(button).not.toHaveClass('px-2', 'text-sm');
		}
	});

	it('opts into the shared adaptive joined grid while mapping All to null', async () => {
		const onSelect = vi.fn();
		render(FilterGroup, {
			props: {
				label: 'Affects',
				items: ITEMS,
				activeKey: 'stops',
				variant: 'joined-grid',
				onSelect,
				testIdPrefix: 'affects',
			},
		});

		const group = screen.getByRole('radiogroup', { name: 'Affects' });
		expect(group).toHaveClass('segmented-choice--joined-grid');
		expect(group).toHaveAttribute('data-segment-count', '3');
		const radios = within(group).getAllByRole('radio');
		expect(radios.map((radio) => radio.textContent?.trim())).toEqual(['All', 'Lines', 'Stops']);
		expect(radios.map((radio) => radio.getAttribute('data-grid-cell'))).toEqual([
			'1:1',
			'1:2',
			'2:1-2',
		]);
		expect(screen.getByTestId('affects-lines')).toHaveTextContent('Lines');
		expect(screen.getByRole('radio', { name: 'Stops' })).toHaveAttribute('aria-checked', 'true');

		await fireEvent.click(screen.getByRole('radio', { name: 'Lines' }));
		expect(onSelect).toHaveBeenLastCalledWith('lines');
		expect(screen.getByRole('radio', { name: 'Stops' })).toHaveAttribute('aria-checked', 'true');

		await fireEvent.click(screen.getByRole('radio', { name: 'All' }));
		expect(onSelect).toHaveBeenLastCalledWith(null);
	});

	it('uses the same shared keyboard engine for joined filters', async () => {
		const onSelect = vi.fn();
		render(FilterGroup, {
			props: {
				label: 'Affects',
				items: ITEMS,
				activeKey: 'stops',
				variant: 'joined-grid',
				onSelect,
			},
		});

		const stops = screen.getByRole('radio', { name: 'Stops' });
		const lines = screen.getByRole('radio', { name: 'Lines' });
		await fireEvent.keyDown(stops, { key: 'ArrowLeft' });
		expect(onSelect).toHaveBeenCalledWith('lines');
		expect(lines).toHaveFocus();
	});

	it.each([
		{
			mode: 'pointer click',
			activate: async (target: HTMLElement) => {
				await fireEvent.click(target, { detail: 1 });
			},
		},
		{
			mode: 'keyboard-style native button activation',
			activate: async (target: HTMLElement) => {
				await fireEvent.keyDown(target, { key: 'Enter' });
				await fireEvent.click(target, { detail: 0 });
				await fireEvent.keyUp(target, { key: 'Enter' });
			},
		},
	])('maps repeated active joined selection to null via $mode', async ({ activate }) => {
		const onSelect = vi.fn();
		render(FilterGroup, {
			props: {
				label: 'Affects',
				items: ITEMS,
				activeKey: 'stops',
				variant: 'joined-grid',
				allowDeselect: true,
				onSelect,
			},
		});

		await activate(screen.getByRole('radio', { name: 'Stops' }));

		expect(onSelect).toHaveBeenCalledOnce();
		expect(onSelect).toHaveBeenCalledWith(null);
		expect(screen.getByRole('radio', { name: 'Stops' })).toHaveAttribute('aria-checked', 'true');
	});

	it('keeps a repeated active joined selection when deselection is disabled', async () => {
		const onSelect = vi.fn();
		render(FilterGroup, {
			props: {
				label: 'Affects',
				items: ITEMS,
				activeKey: 'stops',
				variant: 'joined-grid',
				allowDeselect: false,
				onSelect,
			},
		});

		await fireEvent.click(screen.getByRole('radio', { name: 'Stops' }));

		expect(onSelect).toHaveBeenCalledOnce();
		expect(onSelect).toHaveBeenCalledWith('stops');
	});

	it('delegates joined-grid rendering instead of duplicating keyboard or grid CSS', () => {
		expect(source).toContain(
			"import SegmentedChoice from '$lib/components/surface/SegmentedChoice.svelte'",
		);
		expect(source).toContain('<SegmentedChoice');
		expect(source).not.toContain('.filter-group--joined-grid');
		expect(source).not.toContain('function onkeydown');
	});

	it('renders the label, an "All" reset, and one button per item', () => {
		render(FilterGroup, {
			props: { label: 'Affects', items: ITEMS, activeKey: null, onSelect: vi.fn() },
		});
		expect(screen.getByText('Affects')).toBeInTheDocument();
		// "All" + the two items = three radios.
		const group = screen.getByRole('group', { name: 'Affects' });
		const radios = within(group).getAllByRole('radio');
		expect(radios).toHaveLength(3);
		expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: 'Lines' })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: 'Stops' })).toBeInTheDocument();
	});

	it('resolves allLabel via the active locale (en default)', () => {
		render(FilterGroup, {
			props: {
				label: 'Affects',
				items: ITEMS,
				activeKey: null,
				allLabel: { en: 'Any', fr: 'Tous' },
				onSelect: vi.fn(),
			},
		});
		expect(screen.getByRole('radio', { name: 'Any' })).toBeInTheDocument();
	});

	it('fires onSelect with the item key when an item is chosen', async () => {
		const onSelect = vi.fn();
		render(FilterGroup, {
			props: { label: 'Affects', items: ITEMS, activeKey: null, onSelect },
		});
		await fireEvent.click(screen.getByRole('radio', { name: 'Lines' }));
		expect(onSelect).toHaveBeenCalledWith('lines');
	});

	it('fires onSelect with null when "All" is chosen', async () => {
		const onSelect = vi.fn();
		render(FilterGroup, {
			props: { label: 'Affects', items: ITEMS, activeKey: 'lines', onSelect },
		});
		await fireEvent.click(screen.getByRole('radio', { name: 'All' }));
		expect(onSelect).toHaveBeenCalledWith(null);
	});

	it('is controlled: activeKey drives which item reads aria-checked', () => {
		render(FilterGroup, {
			props: { label: 'Affects', items: ITEMS, activeKey: 'stops', onSelect: vi.fn() },
		});
		expect(screen.getByRole('radio', { name: 'Stops' }).getAttribute('aria-checked')).toBe('true');
		expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('false');
		expect(screen.getByRole('radio', { name: 'Lines' }).getAttribute('aria-checked')).toBe('false');
	});

	it('activeKey=null highlights the "All" reset', () => {
		render(FilterGroup, {
			props: { label: 'Affects', items: ITEMS, activeKey: null, onSelect: vi.fn() },
		});
		expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true');
	});

	it('collapsible: a header toggle button controls the group visibility', async () => {
		render(FilterGroup, {
			props: {
				label: 'Severity',
				items: ITEMS,
				activeKey: null,
				collapsible: true,
				startOpen: false,
				onSelect: vi.fn(),
			},
		});
		// Collapsible renders the label as a disclosure button and keeps closed
		// controls out of the keyboard/accessibility tree while leaving them mounted.
		const header = screen.getByRole('button', { name: /Severity/ });
		expect(header).toBeInTheDocument();
		expect(header).toHaveAttribute('aria-expanded', 'false');
		const collapse = header.parentElement?.querySelector('.filter-collapse');
		expect(collapse).toHaveAttribute('inert');
		expect(collapse).toHaveAttribute('aria-hidden', 'true');
		const controlsId = header.getAttribute('aria-controls');
		expect(controlsId).toBeTruthy();
		expect(collapse).toHaveAttribute('id', controlsId);

		// The group + its items remain in the DOM for animation/state continuity.
		const group = screen.getByRole('group', { hidden: true });
		expect(within(group).getAllByRole('radio', { hidden: true })).toHaveLength(3);

		await fireEvent.click(header);
		expect(header).toHaveAttribute('aria-expanded', 'true');
		expect(collapse).not.toHaveAttribute('inert');
		expect(collapse).not.toHaveAttribute('aria-hidden');
		expect(within(group).getAllByRole('radio')).toHaveLength(3);
	});
});
