import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import FilterSummary from './FilterSummary.svelte';

const currentLocale = vi.hoisted(() => ({ value: 'en' as 'en' | 'fr' }));
vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => currentLocale.value };
});

const COUNT_LABEL = {
	en: { singular: '{count} alert', plural: '{count} alerts' },
	fr: { singular: '{count} résultat', plural: '{count} résultats' },
} as const;

describe('FilterSummary', () => {
	it('renders the singular EN form for count === 1', () => {
		currentLocale.value = 'en';
		render(FilterSummary, { props: { count: 1, countLabel: COUNT_LABEL, onClear: vi.fn() } });
		expect(screen.getByText('1 alert')).toBeInTheDocument();
	});

	it('renders the plural EN form for count !== 1 (0 and N)', () => {
		currentLocale.value = 'en';
		const { unmount } = render(FilterSummary, {
			props: { count: 0, countLabel: COUNT_LABEL, onClear: vi.fn() },
		});
		expect(screen.getByText('0 alerts')).toBeInTheDocument();
		unmount();
		render(FilterSummary, { props: { count: 5, countLabel: COUNT_LABEL, onClear: vi.fn() } });
		expect(screen.getByText('5 alerts')).toBeInTheDocument();
	});

	it('FR treats 0 and 1 as singular, 2+ as plural (French zero rule)', () => {
		currentLocale.value = 'fr';
		const { unmount: u0 } = render(FilterSummary, {
			props: { count: 0, countLabel: COUNT_LABEL, onClear: vi.fn() },
		});
		expect(screen.getByText('0 résultat')).toBeInTheDocument();
		u0();
		const { unmount: u1 } = render(FilterSummary, {
			props: { count: 1, countLabel: COUNT_LABEL, onClear: vi.fn() },
		});
		expect(screen.getByText('1 résultat')).toBeInTheDocument();
		u1();
		render(FilterSummary, { props: { count: 2, countLabel: COUNT_LABEL, onClear: vi.fn() } });
		expect(screen.getByText('2 résultats')).toBeInTheDocument();
		currentLocale.value = 'en';
	});

	it('fires onClear when the clear link is clicked', async () => {
		currentLocale.value = 'en';
		const onClear = vi.fn();
		render(FilterSummary, { props: { count: 3, countLabel: COUNT_LABEL, onClear } });
		const clear = document.querySelector('[data-slot="clear-filters"]') as HTMLElement;
		expect(clear).not.toBeNull();
		await fireEvent.click(clear);
		expect(onClear).toHaveBeenCalledTimes(1);
	});
});
