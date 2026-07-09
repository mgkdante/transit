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

	it('renders the label, an "All" reset, and one button per item', () => {
		render(FilterGroup, {
			props: { label: 'Affects', items: ITEMS, activeKey: null, onSelect: vi.fn() },
		});
		expect(screen.getByText('Affects')).toBeInTheDocument();
		// "All" + the two items = three radios.
		const radios = screen.getAllByRole('radio');
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
		// Collapsible renders the label as a <button> (the toggle); the items still exist.
		const header = screen.getByRole('button', { name: /Severity/ });
		expect(header).toBeInTheDocument();
		// The group + its items are still in the DOM (collapse is CSS grid-rows, not removal).
		const group = screen.getByRole('group');
		expect(within(group).getAllByRole('radio')).toHaveLength(3);
		// Toggling the header does not throw and keeps the items mounted.
		await fireEvent.click(header);
		expect(within(group).getAllByRole('radio')).toHaveLength(3);
	});
});
