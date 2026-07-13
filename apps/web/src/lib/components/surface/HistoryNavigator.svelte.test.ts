import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { previousAvailableDate } from '$lib/v1/history';
import HistoryNavigator from './HistoryNavigator.svelte';
import { HistoryNavigator as BarrelHistoryNavigator } from './index';

const EN = {
	group: 'Browse retained history',
	picker: {
		group: 'History window',
		start: 'From',
		end: 'To',
		clear: 'Full window',
		anyStart: 'Earliest',
		anyEnd: 'Latest',
		single: 'History date',
	},
	previous: 'Previous date',
	next: 'Next date',
} as const;

const FR = {
	group: "Parcourir l'historique conservé",
	picker: {
		group: "Période de l'historique",
		start: 'Du',
		end: 'Au',
		clear: 'Période complète',
		anyStart: 'Première date',
		anyEnd: 'Dernière date',
		single: "Date de l'historique",
	},
	previous: 'Date précédente',
	next: 'Date suivante',
} as const;

const DATES = ['2026-06-01', '2026-06-03', '2026-06-05'] as const;
const OPTIONS = DATES.map((date) => ({ date }));
const source = readFileSync(
	resolve(process.cwd(), 'src/lib/components/surface/HistoryNavigator.svelte'),
	'utf-8',
);

describe('HistoryNavigator — controlled DateRangePicker composition', () => {
	it('exports through the surface barrel', () => {
		expect(BarrelHistoryNavigator).toBe(HistoryNavigator);
	});

	it('composes stacked range mode and dispatches normalized range changes', async () => {
		const onRangeChange = vi.fn();
		const { getByRole, queryByRole } = render(HistoryNavigator, {
			props: {
				mode: 'range',
				locale: 'en',
				labels: EN,
				availableDates: DATES,
				onRangeChange,
			},
		});
		const picker = getByRole('group', { name: 'History window' });
		expect(picker).toHaveClass('date-range--stack');
		expect(picker.querySelectorAll('input[type="date"]')).toHaveLength(2);
		expect(queryByRole('button', { name: 'Previous date' })).toBeNull();

		await fireEvent.change(within(picker).getByLabelText('History window · From'), {
			target: { value: '2026-06-05' },
		});
		await fireEvent.change(within(picker).getByLabelText('History window · To'), {
			target: { value: '2026-06-01' },
		});
		expect(onRangeChange).toHaveBeenLastCalledWith({
			from: '2026-06-01',
			to: '2026-06-05',
		});
	});

	it('composes single-date mode and dispatches the controlled date callback', async () => {
		const onDateChange = vi.fn();
		const { getByLabelText } = render(HistoryNavigator, {
			props: {
				mode: 'date',
				locale: 'en',
				labels: EN,
				date: '2026-06-03',
				dateOptions: OPTIONS,
				onDateChange,
			},
		});

		const input = getByLabelText('History date') as HTMLInputElement;
		expect(input.value).toBe('2026-06-03');
		await fireEvent.change(input, { target: { value: '2026-06-05' } });
		expect(onDateChange).toHaveBeenCalledWith('2026-06-05');
	});
});

describe('HistoryNavigator — caller-owned neighbors and copy', () => {
	it('keeps null neighbors visible and disabled', () => {
		const { getByRole } = render(HistoryNavigator, {
			props: {
				mode: 'date',
				locale: 'en',
				labels: EN,
				date: '2026-06-01',
				dateOptions: OPTIONS,
				previousDate: null,
				nextDate: null,
				onDateChange: vi.fn(),
			},
		});

		expect(getByRole('button', { name: 'Previous date' })).toBeDisabled();
		expect(getByRole('button', { name: 'Next date' })).toBeDisabled();
	});

	it('uses the exact gap-skipping neighbor supplied by the helper', async () => {
		const onDateChange = vi.fn();
		const previousDate = previousAvailableDate('2026-06-03', {
			kind: 'discrete',
			dates: DATES,
		});
		const { getByRole } = render(HistoryNavigator, {
			props: {
				mode: 'date',
				locale: 'en',
				labels: EN,
				date: '2026-06-03',
				dateOptions: OPTIONS,
				previousDate,
				nextDate: '2026-06-05',
				onDateChange,
			},
		});

		await fireEvent.click(getByRole('button', { name: 'Previous date' }));
		expect(onDateChange).toHaveBeenCalledWith('2026-06-01');
	});

	it('renders French labels plus caller-supplied coverage and selection captions', () => {
		const { getByRole, getByText } = render(HistoryNavigator, {
			props: {
				mode: 'date',
				locale: 'fr',
				labels: FR,
				date: '2026-06-03',
				dateOptions: OPTIONS,
				previousDate: '2026-06-01',
				nextDate: '2026-06-05',
				coverageText: 'Couverture : 1 au 5 juin',
				selectionText: 'Date actuelle : 3 juin',
				onDateChange: vi.fn(),
			},
		});

		expect(getByRole('group', { name: "Période de l'historique" })).toBeInTheDocument();
		expect(getByRole('button', { name: 'Date précédente' })).toBeInTheDocument();
		expect(getByRole('button', { name: 'Date suivante' })).toBeInTheDocument();
		expect(getByText('Couverture : 1 au 5 juin')).toBeInTheDocument();
		expect(getByText('Date actuelle : 3 juin')).toBeInTheDocument();
	});

	it('uses exactly one polite atomic status region for caller-supplied correction copy', () => {
		const { getAllByRole, getByRole } = render(HistoryNavigator, {
			props: {
				mode: 'range',
				locale: 'en',
				labels: EN,
				availableDates: DATES,
				announcement: 'That date was unavailable. Showing the latest window.',
			},
		});
		const status = getByRole('status');
		expect(getAllByRole('status')).toHaveLength(1);
		expect(status).toHaveAttribute('aria-live', 'polite');
		expect(status).toHaveAttribute('aria-atomic', 'true');
		expect(status).toHaveTextContent('That date was unavailable. Showing the latest window.');
	});

	it('keeps the live region mounted before a parent supplies correction copy', async () => {
		const props = {
			mode: 'range' as const,
			locale: 'en' as const,
			labels: EN,
			availableDates: DATES,
			announcement: null,
		};
		const view = render(HistoryNavigator, { props });
		const status = view.getByRole('status');
		expect(status.textContent?.trim()).toBe('');
		expect(source).not.toContain('.history-navigator__announcement:empty');

		await view.rerender({ ...props, announcement: 'Showing the nearest available window.' });
		expect(view.getByRole('status')).toBe(status);
		expect(status).toHaveTextContent('Showing the nearest available window.');
	});

	it('can keep correction copy visible without exposing a second live region', () => {
		const view = render(HistoryNavigator, {
			props: {
				mode: 'range',
				locale: 'en',
				labels: EN,
				availableDates: DATES,
				announcement: 'Showing the nearest available window.',
				liveAnnouncement: false,
			},
		});

		const copy = view.container.querySelector('[data-slot="history-announcement"]');
		expect(copy).toHaveTextContent('Showing the nearest available window.');
		expect(copy).not.toHaveAttribute('role');
		expect(copy).not.toHaveAttribute('aria-live');
		expect(copy).not.toHaveAttribute('aria-atomic');
		expect(view.queryByRole('status')).toBeNull();
	});
});

describe('HistoryNavigator — duplicate mount and narrow-rail safety', () => {
	it('keeps two simultaneous controlled copies in sync when the parent rerenders', async () => {
		const props = {
			mode: 'date' as const,
			locale: 'en' as const,
			labels: EN,
			date: '2026-06-01',
			dateOptions: OPTIONS,
			previousDate: null,
			nextDate: '2026-06-03',
		};
		const first = render(HistoryNavigator, { props });
		const second = render(HistoryNavigator, { props });

		expect((within(first.container).getByLabelText('History date') as HTMLInputElement).value).toBe(
			'2026-06-01',
		);
		expect(
			(within(second.container).getByLabelText('History date') as HTMLInputElement).value,
		).toBe('2026-06-01');

		const next = {
			...props,
			date: '2026-06-03',
			previousDate: '2026-06-01',
			nextDate: '2026-06-05',
		};
		await Promise.all([first.rerender(next), second.rerender(next)]);
		expect((within(first.container).getByLabelText('History date') as HTMLInputElement).value).toBe(
			'2026-06-03',
		);
		expect(
			(within(second.container).getByLabelText('History date') as HTMLInputElement).value,
		).toBe('2026-06-03');
	});

	it('contains no local async/state/rail/sheet/pill/URL machinery', () => {
		expect(source).not.toContain('$state');
		expect(source).not.toContain('$effect');
		expect(source).not.toContain('createResource');
		expect(source).not.toContain('SurfaceRail');
		expect(source).not.toContain('CollapsibleSection');
		expect(source).not.toContain('TocNav');
		expect(source).not.toContain('URLSearchParams');
		expect(source).not.toContain('overflow-x: auto');
	});

	it('pins full-width/min-width safety, equal cells, 44px targets, focus, and reduced motion', () => {
		const rootRule = source.match(/\.history-navigator\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		const neighborRule = source.match(/\.history-navigator__neighbors\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		const buttonRule = source.match(/\.history-navigator__step\s*\{([\s\S]*?)\}/)?.[1] ?? '';

		expect(rootRule).toContain('width: 100%');
		expect(rootRule).toContain('max-width: 100%');
		expect(rootRule).toContain('min-width: 0');
		expect(neighborRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
		expect(buttonRule).toContain('min-height: 44px');
		expect(source).toContain('.history-navigator__step:focus-visible');
		expect(source).toContain('outline: 2px solid var(--ring)');
		expect(source).toContain('@media (prefers-reduced-motion: reduce)');
	});

	it('renders no overflow scroller, sheet, pill, or separate disclosure DOM', () => {
		const { container } = render(HistoryNavigator, {
			props: {
				mode: 'date',
				locale: 'en',
				labels: EN,
				date: '2026-06-03',
				dateOptions: OPTIONS,
			},
		});
		expect(container.querySelector('[data-slot*="sheet"]')).toBeNull();
		expect(container.querySelector('[data-slot*="pill"]')).toBeNull();
		expect(container.querySelector('[data-slot*="disclosure"]')).toBeNull();
		expect(container.querySelector('[data-slot*="scroller"]')).toBeNull();
	});
});
