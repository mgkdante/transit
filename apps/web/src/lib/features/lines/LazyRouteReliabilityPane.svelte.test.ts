import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteReliability } from '$lib/v1';
import type { Resource } from '$lib/v1/resource.svelte';
import type { LineHistoryResource } from './reliability/data/lineHistoryResource.svelte';
import LazyRouteReliabilityPane, {
	type RouteReliabilityClustersModule,
} from './LazyRouteReliabilityPane.svelte';

vi.mock('$lib/nav', () => ({ layout: { isDesktop: false } }));

const reliability = (id: string): RouteReliability =>
	({
		id,
		generated_utc: '2026-08-15T00:00:00Z',
	}) as RouteReliability;

const resource = (data: RouteReliability | null): Resource<RouteReliability | null> => ({
	data,
	error: null,
	loading: false,
	settled: true,
	reload: vi.fn(),
});

const history = { state: 'current' } as LineHistoryResource;

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((next, fail) => {
		resolve = next;
		reject = fail;
	});
	return { promise, resolve, reject };
}

afterEach(cleanup);

describe('LazyRouteReliabilityPane', () => {
	it('starts the reliability import on mount and keeps one pending request', async () => {
		const pending = deferred<RouteReliabilityClustersModule>();
		const importClusters = vi.fn(() => pending.promise);
		const view = render(LazyRouteReliabilityPane, {
			props: {
				entityId: '24',
				resource: resource(reliability('24')),
				locale: 'en',
				directionHeadsigns: {},
				history,
				importClusters,
			},
		});

		await tick();
		expect(importClusters).toHaveBeenCalledOnce();
		expect(view.container.querySelector('[data-variant="skeleton"]')).not.toBeNull();

		pending.resolve(await import('./reliability/__fixtures__/RouteReliabilityClustersStub.svelte'));
		expect(await view.findByTestId('route-reliability-clusters-stub')).toHaveAttribute(
			'data-entity-id',
			'24',
		);
		expect(importClusters).toHaveBeenCalledOnce();
	});

	it('renders the current route when it changes while the chunk is pending', async () => {
		const pending = deferred<RouteReliabilityClustersModule>();
		const importClusters = vi.fn(() => pending.promise);
		const view = render(LazyRouteReliabilityPane, {
			props: {
				entityId: '24',
				resource: resource(reliability('24')),
				locale: 'en',
				directionHeadsigns: {},
				history,
				importClusters,
			},
		});

		await tick();
		await view.rerender({
			entityId: 'A/B',
			resource: resource(reliability('A/B')),
			locale: 'en',
			directionHeadsigns: { 0: 'Current route' },
			history,
			importClusters,
		});
		pending.resolve(await import('./reliability/__fixtures__/RouteReliabilityClustersStub.svelte'));

		const clusters = await view.findByTestId('route-reliability-clusters-stub');
		expect(clusters).toHaveAttribute('data-entity-id', 'A/B');
		expect(clusters).toHaveAttribute('data-headsign-count', '1');
		expect(importClusters).toHaveBeenCalledOnce();
	});

	it('keeps the shared error state retryable when the chunk cannot load', async () => {
		const retry = deferred<RouteReliabilityClustersModule>();
		const importClusters = vi
			.fn<() => Promise<RouteReliabilityClustersModule>>()
			.mockRejectedValueOnce(new Error('chunk unavailable'))
			.mockImplementationOnce(() => retry.promise);
		const view = render(LazyRouteReliabilityPane, {
			props: {
				entityId: '24',
				resource: resource(reliability('24')),
				locale: 'en',
				directionHeadsigns: {},
				history,
				importClusters,
			},
		});

		const alert = await view.findByRole('alert');
		expect(alert).toHaveTextContent('Reliability view could not load');
		expect(alert).not.toHaveTextContent('/v1 contract');
		await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
		expect(importClusters).toHaveBeenCalledTimes(2);

		retry.resolve(await import('./reliability/__fixtures__/RouteReliabilityClustersStub.svelte'));
		await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
		expect(view.getByTestId('route-reliability-clusters-stub')).toHaveAttribute(
			'data-entity-id',
			'24',
		);
		expect(alert).not.toBeVisible();
	});
});
