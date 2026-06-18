import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import StopsIndex from './StopsIndex.svelte';

vi.mock('$lib/v1', () => ({
	getStopsIndex: vi.fn(),
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: {
			generated_utc: '2026-06-16T02:00:00Z',
			stops: [
				{ id: '57191', name: 'Van Horne / Rockland', lat: 45.5, lon: -73.6, code: '57191' },
				{ id: '11000', name: 'Station Crémazie', lat: 45.55, lon: -73.62, code: '11000' },
			],
		},
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

describe('StopsIndex map drilldown', () => {
	it('keeps the stop detail link and adds a separate filtered-map link', async () => {
		render(StopsIndex);

		await fireEvent.input(screen.getByRole('searchbox', { name: 'Search stops' }), {
			target: { value: 'rockland' },
		});

		expect(screen.getByRole('link', { name: /Van Horne \/ Rockland/i })).toHaveAttribute(
			'href',
			'/stop/57191',
		);
		expect(screen.getByRole('link', { name: 'View stop 57191 on map' })).toHaveAttribute(
			'href',
			'/map?stop=57191',
		);
	});

	it('finds an accented station typed without accents and tags it as métro', async () => {
		render(StopsIndex);

		await fireEvent.input(screen.getByRole('searchbox', { name: 'Search stops' }), {
			target: { value: 'cremazie' },
		});

		expect(screen.getByRole('link', { name: /Station Crémazie/i })).toHaveAttribute(
			'href',
			'/stop/11000',
		);
		expect(screen.getByText('Métro')).toBeInTheDocument();
	});
});
