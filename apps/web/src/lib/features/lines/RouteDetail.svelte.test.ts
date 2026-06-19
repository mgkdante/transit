import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RouteDetail from './RouteDetail.svelte';

vi.mock('$lib/v1', () => ({
	getRoute: vi.fn(),
	getRouteReliability: vi.fn(),
}));

vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: null,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

describe('RouteDetail map drilldown', () => {
	it('links directly to the live map filtered to this route', () => {
		render(RouteDetail, { props: { id: '161' } });

		expect(screen.getByRole('link', { name: 'View route 161 on map' })).toHaveAttribute(
			'href',
			'/map?route=161&focus=route%3A161',
		);
	});
});
