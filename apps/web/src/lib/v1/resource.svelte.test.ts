import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';

const mocks = vi.hoisted(() => ({
	bumpRefreshEpoch: () => {},
	resetRefreshEpoch: () => {},
}));
vi.mock('$lib/stores/refresh.svelte', async () => {
	const { createSubscriber } = await import('svelte/reactivity');
	let refreshEpoch = 0;
	const subscribe = createSubscriber((update) => {
		mocks.bumpRefreshEpoch = () => {
			refreshEpoch += 1;
			update();
		};
		mocks.resetRefreshEpoch = () => {
			refreshEpoch = 0;
			update();
		};
	});
	return {
		dataRefresh: {
			get epoch() {
				subscribe();
				return refreshEpoch;
			},
		},
	};
});

import { dataRefresh } from '$lib/stores/refresh.svelte';
import { configureV1Runtime } from './runtime';
import { createResource } from './resource.svelte';

configureV1Runtime({ refresh: dataRefresh });

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
	it('refetches when an id read SYNCHRONOUSLY before the await changes', async () => {
		let id = $state('A');
		const seen: string[] = [];
		const getIdx = vi.fn(async () => ({ ok: true }));

		const cleanup = $effect.root(() => {
			createResource(async () => {
				const captured = id;
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
				expect(seen).toContain('B');
			});
			expect(getIdx).toHaveBeenCalledTimes(2);
		} finally {
			cleanup();
		}
	});

	it('does NOT refetch when the id is read only AFTER the await (the bug shape)', async () => {
		let id = $state('A');
		const seen: string[] = [];
		const getIdx = vi.fn(async () => ({ ok: true }));

		const cleanup = $effect.root(() => {
			createResource(async () => {
				await getIdx();
				const captured = id;
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
			await Promise.resolve();
			flushSync();

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

	it('refetches when the installed refresh epoch changes', async () => {
		mocks.resetRefreshEpoch();
		const fetcher = vi.fn(async () => 'value');
		const cleanup = $effect.root(() => {
			createResource(fetcher);
			flushSync();
		});
		try {
			await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
			mocks.bumpRefreshEpoch();
			flushSync();
			await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
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

	it('defers an optional resource until its reactive enabled gate opens', async () => {
		let enabled = $state(false);
		const fetcher = vi.fn(async () => 'ready');
		let resource!: ReturnType<typeof createResource<string>>;

		const cleanup = $effect.root(() => {
			resource = createResource(fetcher, { enabled: () => enabled });
			flushSync();
		});

		try {
			expect(fetcher).not.toHaveBeenCalled();
			expect(resource.loading).toBe(false);
			expect(resource.settled).toBe(false);

			enabled = true;
			flushSync();
			await vi.waitFor(() => {
				flushSync();
				expect(resource.data).toBe('ready');
			});
			expect(fetcher).toHaveBeenCalledTimes(1);
		} finally {
			cleanup();
		}
	});
});

describe('createResource — cancellation ownership', () => {
	it('exposes a matching seed before the first effect flush without consuming reload', () => {
		const key = $state('A');
		const seed = $state<{ key: string; data: string | null }>({
			key: 'A',
			data: 'server-A',
		});
		const fetcher = vi.fn(() => deferred<string>().promise);
		let resource!: ReturnType<typeof createResource<string>>;
		let initial!: Pick<typeof resource, 'data' | 'loading' | 'settled'>;

		const cleanup = $effect.root(() => {
			resource = createResource(fetcher, {
				key: () => key,
				seed: () => seed,
			});
			initial = {
				data: resource.data,
				loading: resource.loading,
				settled: resource.settled,
			};
		});

		try {
			expect(initial).toEqual({ data: 'server-A', loading: false, settled: true });
			expect(fetcher).not.toHaveBeenCalled();

			flushSync();
			expect(resource.data).toBe('server-A');
			expect(fetcher).not.toHaveBeenCalled();

			resource.reload();
			flushSync();
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(resource.data).toBe('server-A');
			expect(resource.loading).toBe(true);
		} finally {
			cleanup();
		}
	});

	it('preserves the initial object identity when hydration consumes its server seed', () => {
		const seed = { key: 'A', data: { rows: [{ value: 42 }] } };
		const fetcher = vi.fn(async () => seed.data);
		let resource!: ReturnType<typeof createResource<typeof seed.data>>;
		let initial!: typeof resource.data;
		const cleanup = $effect.root(() => {
			resource = createResource(fetcher, { key: () => 'A', seed: () => seed });
			initial = resource.data;
		});
		try {
			flushSync();
			expect(resource.data).toBe(initial);
			expect(resource.data?.rows).toBe(initial?.rows);
			expect(fetcher).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	it('accepts a server seed replaced before the first hydration effect', () => {
		const seed = $state({ key: 'A', data: { value: 42 } });
		const fetcher = vi.fn(async () => seed.data);
		let resource!: ReturnType<typeof createResource<typeof seed.data>>;
		const cleanup = $effect.root(() => {
			resource = createResource(fetcher, { key: () => 'A', seed: () => seed });
		});
		try {
			seed.data = { value: 99 };
			flushSync();
			expect(resource.data?.value).toBe(99);
			expect(fetcher).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	it('retains the timestamp on an accepted seed without a duplicate fetch', () => {
		const seeded = {
			generated_utc: '2026-07-14T12:00:00Z',
		};
		const fetcher = vi.fn(async () => seeded);

		let resource!: ReturnType<typeof createResource<typeof seeded>>;
		const cleanup = $effect.root(() => {
			resource = createResource(fetcher, {
				key: () => 'provenance',
				seed: () => ({ key: 'provenance', data: seeded }),
			});
			flushSync();
		});

		try {
			expect(resource.data?.generated_utc).toBe(seeded.generated_utc);
			expect(fetcher).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	it('does not refetch a keyed entity when its first response records the resolved key', async () => {
		const key = $state('A');
		const first = deferred<string>();
		const fetcher = vi.fn(() => first.promise);
		let resource!: ReturnType<typeof createResource<string>>;

		const cleanup = $effect.root(() => {
			resource = createResource(fetcher, { key: () => key });
			flushSync();
		});

		try {
			expect(fetcher).toHaveBeenCalledTimes(1);

			first.resolve('entity-A');
			await vi.waitFor(() => {
				flushSync();
				expect(resource.data).toBe('entity-A');
			});
			await Promise.resolve();
			flushSync();

			expect(fetcher).toHaveBeenCalledTimes(1);
		} finally {
			cleanup();
		}
	});

	it('hides resolved entity A immediately when a keyed navigation starts loading entity B', async () => {
		let key = $state('A');
		const requests = new Map<string, ReturnType<typeof deferred<string>>>();
		let resource!: ReturnType<typeof createResource<string>>;

		const cleanup = $effect.root(() => {
			resource = createResource(
				() => {
					const activeKey = key;
					const pending = deferred<string>();
					requests.set(activeKey, pending);
					return pending.promise;
				},
				{ key: () => key },
			);
			flushSync();
		});

		try {
			requests.get('A')?.resolve('entity-A');
			await vi.waitFor(() => {
				flushSync();
				expect(resource.data).toBe('entity-A');
			});

			key = 'B';
			flushSync();

			expect(resource.data).toBeNull();
			expect(resource.loading).toBe(true);
			expect(resource.settled).toBe(false);

			requests.get('B')?.resolve('entity-B');
			await vi.waitFor(() => {
				flushSync();
				expect(resource.data).toBe('entity-B');
			});
		} finally {
			cleanup();
		}
	});

	it('applies a matching server seed without a duplicate fetch and refreshes it on demand', async () => {
		let key = $state('A');
		let seed = $state<{ key: string; data: string | null } | undefined>({
			key: 'A',
			data: 'server-A',
		});
		const pending = deferred<string>();
		const fetcher = vi.fn(() => {
			void key;
			return pending.promise;
		});
		let resource!: ReturnType<typeof createResource<string>>;

		const cleanup = $effect.root(() => {
			resource = createResource(fetcher, {
				key: () => key,
				seed: () => seed,
			});
			flushSync();
		});

		try {
			expect(resource.data).toBe('server-A');
			expect(resource.settled).toBe(true);
			expect(fetcher).not.toHaveBeenCalled();

			seed = { key: 'B', data: 'server-B' };
			key = 'B';
			flushSync();
			expect(resource.data).toBe('server-B');
			expect(fetcher).not.toHaveBeenCalled();

			resource.reload();
			flushSync();
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(resource.data).toBe('server-B');
			expect(resource.loading).toBe(true);

			pending.resolve('fresh-B');
			await vi.waitFor(() => {
				flushSync();
				expect(resource.data).toBe('fresh-B');
			});
		} finally {
			cleanup();
		}
	});

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
