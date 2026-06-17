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
			stops: [{ id: '57191', name: 'Van Horne / Rockland', lat: 45.5, lon: -73.6, code: '57191' }],
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
});
