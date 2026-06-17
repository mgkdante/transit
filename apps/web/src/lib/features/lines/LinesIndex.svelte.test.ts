import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import LinesIndex from './LinesIndex.svelte';

vi.mock('$lib/v1', () => ({
	getRoutesIndex: vi.fn(),
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: {
			generated_utc: '2026-06-16T02:00:00Z',
			routes: [{ id: '161', short: '161', long: 'Van Horne', type: 3 }],
		},
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

describe('LinesIndex map drilldown', () => {
	it('keeps the route detail link and adds a separate filtered-map link', () => {
		render(LinesIndex);

		expect(screen.getByRole('link', { name: /161 Van Horne/i })).toHaveAttribute(
			'href',
			'/route/161',
		);
		expect(screen.getByRole('link', { name: 'View route 161 on map' })).toHaveAttribute(
			'href',
			'/map?route=161',
		);
	});
});
