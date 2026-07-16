// ResourceBoundary.svelte.test.ts — the boundary branches on the reason-typed
// DataState (asDataState). Locks the render ladder, especially the now-reachable
// `no_results` variant (a filter excluded everything — distinct from no data at
// all, which was previously rendered as a plain `empty`).

import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ResourceBoundary from './ResourceBoundary.svelte';
import { DEFAULT_LOADING_SKELETON_DELAY_MS } from '$lib/components/edge';
import type { Resource } from '$lib/v1/resource.svelte';

function res<T>(p: Partial<Resource<T>>): Resource<T> {
	return { data: null, error: null, loading: false, settled: true, reload: () => {}, ...p };
}

// A trivial children snippet that marks the loaded ("ok") branch.
const okChild = createRawSnippet(() => ({ render: () => `<p data-testid="ok">loaded</p>` }));

function variant(container: HTMLElement): string | null {
	return container.querySelector('[data-slot="edge-state"]')?.getAttribute('data-variant') ?? null;
}

describe('ResourceBoundary — DataState render ladder', () => {
	it('renders children on ok (and no edge state)', () => {
		const { container, getByTestId } = render(ResourceBoundary, {
			props: { resource: res<number[]>({ data: [1, 2] }), lang: 'en', children: okChild },
		});
		expect(getByTestId('ok')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="edge-state"]')).toBeNull();
	});

	it('renders the no-results edge state when a filter excluded everything', () => {
		const { container, queryByTestId } = render(ResourceBoundary, {
			props: {
				resource: res<number[]>({ data: [] }),
				lang: 'en',
				isNoResults: (d) => Array.isArray(d) && d.length === 0,
				children: okChild,
			},
		});
		expect(variant(container)).toBe('no-results');
		expect(queryByTestId('ok')).toBeNull();
	});

	it('renders a plain empty (not no-results) when there is genuinely no data', () => {
		const { container } = render(ResourceBoundary, {
			props: {
				resource: res<number[]>({ data: [] }),
				lang: 'en',
				isEmpty: (d) => Array.isArray(d) && d.length === 0,
				children: okChild,
			},
		});
		expect(variant(container)).toBe('empty');
	});

	it('uses the delayed shared skeleton for a slow loading resource', async () => {
		vi.useFakeTimers();

		try {
			const { container } = render(ResourceBoundary, {
				props: {
					resource: res<number[]>({ loading: true, settled: false }),
					lang: 'en',
					children: okChild,
				},
			});
			const skeleton = container.querySelector('[data-variant="skeleton"]');

			expect(variant(container)).toBe('skeleton');
			expect(skeleton).toHaveAttribute('data-loading-state', 'pending');
			expect(skeleton).toHaveAttribute('aria-hidden', 'true');

			await vi.advanceTimersByTimeAsync(DEFAULT_LOADING_SKELETON_DELAY_MS);
			expect(skeleton).toHaveAttribute('data-loading-state', 'visible');
			expect(skeleton).toHaveAttribute('aria-busy', 'true');
		} finally {
			vi.useRealTimers();
		}
	});

	it('renders the error edge state when there is no value and the load failed', () => {
		const { container } = render(ResourceBoundary, {
			props: {
				resource: res<number[]>({ error: new Error('boom') }),
				lang: 'en',
				children: okChild,
			},
		});
		expect(variant(container)).toBe('error-v1');
	});

	it('forwards notice presentation to the empty branch', () => {
		const { container } = render(ResourceBoundary, {
			props: {
				resource: res<number[]>({ data: [] }),
				lang: 'en',
				presentation: 'silo',
				isEmpty: (d) => Array.isArray(d) && d.length === 0,
				children: okChild,
			},
		});
		expect(container.querySelector('[data-slot="edge-state"]')).toHaveAttribute(
			'data-presentation',
			'silo',
		);
	});

	it('forwards notice presentation to the no-results branch', () => {
		const { container } = render(ResourceBoundary, {
			props: {
				resource: res<number[]>({ data: [] }),
				lang: 'en',
				presentation: 'silo',
				isNoResults: (d) => Array.isArray(d) && d.length === 0,
				children: okChild,
			},
		});
		expect(container.querySelector('[data-slot="edge-state"]')).toHaveAttribute(
			'data-presentation',
			'silo',
		);
	});

	it('forwards notice presentation to the error branch', () => {
		const { container } = render(ResourceBoundary, {
			props: {
				resource: res<number[]>({ error: new Error('boom') }),
				lang: 'en',
				presentation: 'silo',
				children: okChild,
			},
		});
		expect(container.querySelector('[data-slot="edge-state"]')).toHaveAttribute(
			'data-presentation',
			'silo',
		);
	});

	it('defaults message states to responsive presentation', () => {
		const { container } = render(ResourceBoundary, {
			props: {
				resource: res<number[]>({ data: [] }),
				lang: 'en',
				isEmpty: (d) => Array.isArray(d) && d.length === 0,
				children: okChild,
			},
		});
		expect(container.querySelector('[data-slot="edge-state"]')).toHaveAttribute(
			'data-presentation',
			'responsive',
		);
	});

	it('accepts card presentation for message states', () => {
		const { container } = render(ResourceBoundary, {
			props: {
				resource: res<number[]>({ data: [] }),
				lang: 'en',
				presentation: 'card',
				isEmpty: (d) => Array.isArray(d) && d.length === 0,
				children: okChild,
			},
		});
		expect(container.querySelector('[data-slot="edge-state"]')).toHaveAttribute(
			'data-presentation',
			'card',
		);
	});
});
