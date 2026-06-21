import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createResource } from './resource.svelte';

// A deferred so a test can hold a fetch open and assert in-flight ordering if needed.
function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe('createResource — reactivity to inputs read inside the fetcher', () => {
	// The contract (resource.svelte.ts:60-79): the fetcher's reactive reads are
	// tracked only when invoked SYNCHRONOUSLY inside the $effect, i.e. everything
	// before the first await. A reactive input read AFTER an await is in a microtask
	// outside the tracking window → NOT a dependency → the resource never refetches
	// when that input changes. This is the exact trap the RouteDetail reliability
	// gate fell into (slice-9.7 C4): it read `id` only after `await getRoutesIndex()`,
	// so /route/A → /route/B kept showing A's reliability. These tests pin BOTH the
	// correct (sync-read) and the broken (post-await-read) shapes so the regression
	// can never silently come back.

	it('refetches when an id read SYNCHRONOUSLY before the await changes', async () => {
		let id = $state('A');
		const seen: string[] = [];
		const getIdx = vi.fn(async () => ({ ok: true }));

		const cleanup = $effect.root(() => {
			// Mirrors the FIXED RouteDetail thunk: capture the reactive key first.
			createResource(async () => {
				const captured = id; // sync read → tracked dependency
				await getIdx();
				seen.push(captured);
				return captured;
			});
			flushSync();
		});

		try {
			await vi.waitFor(() => {
				flushSync();
				expect(seen).toContain('A');
			});

			id = 'B';
			flushSync();

			await vi.waitFor(() => {
				flushSync();
				// The resource MUST re-run for 'B' — the staleness gate.
				expect(seen).toContain('B');
			});
			expect(getIdx).toHaveBeenCalledTimes(2);
		} finally {
			cleanup();
		}
	});

	it('does NOT refetch when the id is read only AFTER the await (the bug shape)', async () => {
		// This is the empirical probe from the C4 finding, frozen as a guard: a thunk
		// that reads `id` post-await never registers it as a dependency, so the second
		// id is never seen. We assert the BROKEN behaviour so the test doubles as a
		// living explanation of WHY the fix must capture the key synchronously.
		let id = $state('A');
		const seen: string[] = [];
		const getIdx = vi.fn(async () => ({ ok: true }));

		const cleanup = $effect.root(() => {
			createResource(async () => {
				await getIdx(); // ONLY synchronous statement reads nothing reactive
				const captured = id; // read AFTER await → NOT tracked
				seen.push(captured);
				return captured;
			});
			flushSync();
		});

		try {
			await vi.waitFor(() => {
				flushSync();
				expect(seen).toContain('A');
			});

			id = 'B';
			flushSync();
			// Give any (erroneously) scheduled refetch a chance to run.
			await Promise.resolve();
			flushSync();

			// The post-await read is invisible to the tracker: no refetch, never 'B'.
			expect(seen).toEqual(['A']);
			expect(getIdx).toHaveBeenCalledTimes(1);
		} finally {
			cleanup();
		}
	});

	it('exposes the latest value and settles after the fetch resolves', async () => {
		const d = deferred<number>();
		let resource!: ReturnType<typeof createResource<number>>;

		const cleanup = $effect.root(() => {
			resource = createResource(() => d.promise);
			flushSync();
		});

		try {
			expect(resource.loading).toBe(true);
			expect(resource.data).toBeNull();

			d.resolve(42);
			await vi.waitFor(() => {
				flushSync();
				expect(resource.data).toBe(42);
			});
			expect(resource.loading).toBe(false);
			expect(resource.settled).toBe(true);
			expect(resource.error).toBeNull();
		} finally {
			cleanup();
		}
	});

	it('reload() re-runs the fetcher without changing inputs', async () => {
		const fetcher = vi.fn(async () => 'x');
		let resource!: ReturnType<typeof createResource<string>>;

		const cleanup = $effect.root(() => {
			resource = createResource(fetcher);
			flushSync();
		});

		try {
			await vi.waitFor(() => {
				flushSync();
				expect(resource.data).toBe('x');
			});
			expect(fetcher).toHaveBeenCalledTimes(1);

			resource.reload();
			flushSync();
			await vi.waitFor(() => {
				flushSync();
				expect(fetcher).toHaveBeenCalledTimes(2);
			});
		} finally {
			cleanup();
		}
	});
});
