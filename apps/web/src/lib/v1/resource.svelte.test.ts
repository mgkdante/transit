import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';

// Capture the shared newest-data writer so the freshness-bearing tests can assert
// exactly what createResource feeds it. Mock $lib/stores BEFORE importing the
// resource (which imports dataRefresh from it).
const mocks = vi.hoisted(() => ({
	noteDataGeneratedUtc: vi.fn<(v: string | null | undefined) => void>(),
}));
vi.mock('$lib/stores/refresh.svelte', () => ({
	dataRefresh: {
		// `epoch` must be a reactive-looking getter so the resource's effect tracks it.
		get epoch() {
			return 0;
		},
		noteDataGeneratedUtc: mocks.noteDataGeneratedUtc,
	},
}));

import { createResource } from './resource.svelte';

// A deferred so a test can hold a fetch open and assert in-flight ordering if needed.
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('createResource — reactivity to inputs read inside the fetcher', () => {
	// The contract (resource.svelte.ts:60-79): the fetcher's reactive reads are
	// tracked only when invoked SYNCHRONOUSLY inside the $effect, i.e. everything
	// before the first await. A reactive input read AFTER an await is in a microtask
	// outside the tracking window → NOT a dependency → the resource never refetches
	// when that input changes. This is the exact trap the RouteDetail reliability
	// gate fell into (slice-9.7 C4): it read `id` only after `await getRoutesIndex()`,
	// so /lines/A → /lines/B kept showing A's reliability. These tests pin BOTH the
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

	it('feeds noteDataGeneratedUtc when the payload has generated_utc AND the freshness flag', async () => {
		mocks.noteDataGeneratedUtc.mockClear();
		const cleanup = $effect.root(() => {
			createResource(async () => ({ generated_utc: '2026-06-20T00:00:00Z', x: 1 }), {
				freshness: true,
			});
			flushSync();
		});
		try {
			await vi.waitFor(() => {
				flushSync();
				expect(mocks.noteDataGeneratedUtc).toHaveBeenCalledWith('2026-06-20T00:00:00Z');
			});
		} finally {
			cleanup();
		}
	});

	it('does NOT feed the shared timestamp without the freshness flag', async () => {
		mocks.noteDataGeneratedUtc.mockClear();
		const cleanup = $effect.root(() => {
			createResource(async () => ({ generated_utc: '2026-06-20T00:00:00Z' }));
			flushSync();
		});
		try {
			await vi.waitFor(() => {
				flushSync();
				expect(true).toBe(true);
			});
			// One microtask settle, then assert it was never called.
			await Promise.resolve();
			flushSync();
			expect(mocks.noteDataGeneratedUtc).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	it('feeds nothing (no crash) when a freshness-bearing payload is null', async () => {
		mocks.noteDataGeneratedUtc.mockClear();
		const cleanup = $effect.root(() => {
			createResource(async () => null, { freshness: true });
			flushSync();
		});
		try {
			await vi.waitFor(() => {
				flushSync();
				expect(mocks.noteDataGeneratedUtc).toHaveBeenCalledWith(undefined);
			});
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

describe('createResource — cancellation ownership', () => {
	it('aborts superseded request A and lets only request B populate state', async () => {
		let key = $state('A');
		const requests: Array<{
			key: string;
			signal: AbortSignal;
			pending: ReturnType<typeof deferred<string>>;
		}> = [];
		let resource!: ReturnType<typeof createResource<string>>;

		const cleanup = $effect.root(() => {
			resource = createResource((signal) => {
				const captured = key;
				const pending = deferred<string>();
				requests.push({ key: captured, signal, pending });
				return pending.promise;
			});
			flushSync();
		});

		try {
			expect(requests.map((request) => request.key)).toEqual(['A']);
			key = 'B';
			flushSync();
			expect(requests.map((request) => request.key)).toEqual(['A', 'B']);
			expect(requests[0].signal.aborted).toBe(true);
			expect(requests[1].signal.aborted).toBe(false);

			requests[0].pending.resolve('stale-A');
			await Promise.resolve();
			flushSync();
			expect(resource.data).toBeNull();

			requests[1].pending.resolve('fresh-B');
			await vi.waitFor(() => {
				flushSync();
				expect(resource.data).toBe('fresh-B');
			});
			expect(resource.error).toBeNull();
		} finally {
			cleanup();
		}
	});

	it('reload aborts the current attempt before starting its replacement', () => {
		const signals: AbortSignal[] = [];
		let resource!: ReturnType<typeof createResource<string>>;
		const cleanup = $effect.root(() => {
			resource = createResource((signal) => {
				signals.push(signal);
				return deferred<string>().promise;
			});
			flushSync();
		});

		try {
			expect(signals).toHaveLength(1);
			resource.reload();
			flushSync();
			expect(signals).toHaveLength(2);
			expect(signals[0].aborted).toBe(true);
			expect(signals[1].aborted).toBe(false);
		} finally {
			cleanup();
		}
	});

	it('aborts the current attempt on effect teardown', () => {
		let signal!: AbortSignal;
		const cleanup = $effect.root(() => {
			createResource((attemptSignal) => {
				signal = attemptSignal;
				return deferred<string>().promise;
			});
			flushSync();
		});

		expect(signal.aborted).toBe(false);
		cleanup();
		expect(signal.aborted).toBe(true);
	});

	it('keeps AbortError silent while preserving settled state', async () => {
		let resource!: ReturnType<typeof createResource<string>>;
		const cleanup = $effect.root(() => {
			resource = createResource(async () => {
				throw new DOMException('cancelled', 'AbortError');
			});
			flushSync();
		});

		try {
			await vi.waitFor(() => {
				flushSync();
				expect(resource.settled).toBe(true);
			});
			expect(resource.loading).toBe(false);
			expect(resource.error).toBeNull();
		} finally {
			cleanup();
		}
	});

	it('still surfaces a real failure unchanged', async () => {
		const failure = new Error('network failed');
		let resource!: ReturnType<typeof createResource<string>>;
		const cleanup = $effect.root(() => {
			resource = createResource(async () => {
				throw failure;
			});
			flushSync();
		});

		try {
			await vi.waitFor(() => {
				flushSync();
				expect(resource.settled).toBe(true);
			});
			expect(resource.error).toBe(failure);
			expect(resource.loading).toBe(false);
		} finally {
			cleanup();
		}
	});
});
