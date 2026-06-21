import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import type { RouteReliability, RoutesIndex, StopReliability } from './schemas';

// Hoisted fetch spies the loader reaches through the repositories barrel.
const routeFetch = vi.fn<(id: string) => Promise<RouteReliability | null>>();
const stopFetch = vi.fn<(id: string) => Promise<StopReliability | null>>();
// The internal availability index the ROUTE loader consults for `known:undefined`.
const routesIndexFetch = vi.fn<() => Promise<RoutesIndex>>();

vi.mock('./repositories', () => ({
	getRouteReliability: (id: string) => routeFetch(id),
	getStopReliability: (id: string) => stopFetch(id),
	getRoutesIndex: () => routesIndexFetch(),
}));

import { createReliabilityLoader } from './reliabilitySnapshot.svelte';

/** A minimal routes_index with the given id→reliability-flag entries. */
function routesIndex(entries: Array<{ id: string; reliability?: boolean }>): RoutesIndex {
	return {
		generated_utc: '2026-06-18T00:00:00Z',
		routes: entries.map((e) => ({
			id: e.id,
			short: e.id,
			type: 3,
			...(e.reliability === undefined ? {} : { reliability: e.reliability }),
		})),
	} as RoutesIndex;
}

/** A deferred promise so a test can hold fetches open and probe the cap. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function routeFile(id: string, otps: Array<number | null>): RouteReliability {
	return {
		generated_utc: '2026-06-18T00:00:00Z',
		id,
		periods: otps.map((otp_pct, i) => ({
			grain: 'day',
			date: `2026-06-${String(i + 1).padStart(2, '0')}`,
			otp_pct,
		})),
	} as RouteReliability;
}

beforeEach(() => {
	routeFetch.mockReset();
	stopFetch.mockReset();
	routesIndexFetch.mockReset();
	// Default: an empty index ⇒ every `known:undefined` route id is "absent from
	// the index" ⇒ legacy fail-soft probe. Tests that exercise the internal skip
	// override this with their own routesIndex(...).
	routesIndexFetch.mockResolvedValue(routesIndex([]));
});

describe('createReliabilityLoader — cache', () => {
	it('fetches each id AT MOST ONCE even across repeated requests', async () => {
		routeFetch.mockResolvedValue(routeFile('161', [90, 92, 95]));
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request('161');
			loader.request('161');
			loader.request('161');
			flushSync();
		});
		await vi.waitFor(() => expect(routeFetch).toHaveBeenCalledTimes(1));
		cleanup();
	});

	it('summarizes the latest day OTP into a ready verdict snapshot', async () => {
		routeFetch.mockResolvedValue(routeFile('24', [70, 80, 95]));
		let snap = { phase: 'idle', otpPct: null as number | null, verdict: null as string | null };
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request('24');
			flushSync();
			$effect(() => {
				const s = loader.get('24');
				snap = { phase: s.phase, otpPct: s.otpPct, verdict: s.verdict };
			});
		});
		await vi.waitFor(() => {
			flushSync();
			expect(snap.phase).toBe('ready');
		});
		expect(snap.otpPct).toBe(95);
		expect(snap.verdict).toBe('on_time');
		cleanup();
	});
});

describe('createReliabilityLoader — concurrency cap', () => {
	it('never runs more than the cap (4) fetches at once', async () => {
		const gates = new Map<string, ReturnType<typeof deferred<RouteReliability>>>();
		routeFetch.mockImplementation((id: string) => {
			const d = deferred<RouteReliability>();
			gates.set(id, d);
			return d.promise;
		});

		let loaderRef!: ReturnType<typeof createReliabilityLoader>;
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loaderRef = loader;
			// Request 8 ids at once with an explicit `known: true` so they probe
			// immediately (the cap is independent of the internal index gate, which
			// is exercised separately below).
			for (let i = 0; i < 8; i++) loader.request({ id: `r${i}`, known: true });
			flushSync();
			expect(loader.inFlight).toBe(4);
			expect(routeFetch).toHaveBeenCalledTimes(4);
		});
		// Resolve two — two queued ones should start.
		gates.get('r0')!.resolve(routeFile('r0', [90]));
		gates.get('r1')!.resolve(routeFile('r1', [90]));
		await vi.waitFor(() => expect(routeFetch).toHaveBeenCalledTimes(6));
		expect(loaderRef.inFlight).toBe(4);
		cleanup();
	});
});

describe('createReliabilityLoader — known-absent skip (kills the 404 flood)', () => {
	it('does NOT fetch when known === false, resolving straight to empty', async () => {
		routeFetch.mockResolvedValue(routeFile('199', [90]));
		let phase = 'idle';
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request({ id: '199', known: false });
			flushSync();
			$effect(() => {
				phase = loader.get('199').phase;
			});
		});
		await vi.waitFor(() => {
			flushSync();
			expect(phase).toBe('empty');
		});
		// The whole point: zero network probe for a known-absent id.
		expect(routeFetch).not.toHaveBeenCalled();
		cleanup();
	});

	it('STILL fetches when known === true (route has history)', async () => {
		routeFetch.mockResolvedValue(routeFile('161', [90, 95]));
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request({ id: '161', known: true });
			flushSync();
		});
		await vi.waitFor(() => expect(routeFetch).toHaveBeenCalledTimes(1));
		cleanup();
	});

	it('STILL fetches when known is undefined (pre-flag snapshot — no regression)', async () => {
		routeFetch.mockResolvedValue(routeFile('162', [88]));
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			// object form without `known`, and bare-string form, both probe.
			loader.request({ id: '162' });
			loader.request('163');
			flushSync();
		});
		await vi.waitFor(() => expect(routeFetch).toHaveBeenCalledTimes(2));
		cleanup();
	});
});

describe('createReliabilityLoader — internal index gate (bulletproof, known:undefined)', () => {
	it('(a) does NOT probe a route the index marks reliability:false, even with known undefined', async () => {
		// The metro case: a stale call site drops `known`, but the loader consults
		// the index and skips the probe anyway → no 404 flood.
		routesIndexFetch.mockResolvedValue(
			routesIndex([
				{ id: '1', reliability: false },
				{ id: '11', reliability: true },
			]),
		);
		routeFetch.mockResolvedValue(routeFile('1', [90]));
		let phase = 'idle';
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request('1'); // bare id ⇒ known undefined
			flushSync();
			$effect(() => {
				phase = loader.get('1').phase;
			});
		});
		await vi.waitFor(() => {
			flushSync();
			expect(phase).toBe('empty');
		});
		// The whole point: zero network probe for an index-known-absent id.
		expect(routeFetch).not.toHaveBeenCalled();
		cleanup();
	});

	it('(b) STILL probes a route the index marks reliability:true (known undefined)', async () => {
		routesIndexFetch.mockResolvedValue(routesIndex([{ id: '11', reliability: true }]));
		routeFetch.mockResolvedValue(routeFile('11', [92, 95]));
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request('11'); // bare id ⇒ known undefined ⇒ index says probe
			flushSync();
		});
		await vi.waitFor(() => expect(routeFetch).toHaveBeenCalledWith('11'));
		expect(routeFetch).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it('(c) STILL probes a route ABSENT from the index (fail-soft, known undefined)', async () => {
		// Only route 1 is in the index; 999 is unknown ⇒ legacy fail-soft probe.
		routesIndexFetch.mockResolvedValue(routesIndex([{ id: '1', reliability: false }]));
		routeFetch.mockResolvedValue(routeFile('999', [88]));
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request('999');
			flushSync();
		});
		await vi.waitFor(() => expect(routeFetch).toHaveBeenCalledWith('999'));
		expect(routeFetch).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it('loads the routes_index AT MOST ONCE across many undecided requests', async () => {
		routesIndexFetch.mockResolvedValue(
			routesIndex([
				{ id: '1', reliability: false },
				{ id: '2', reliability: false },
				{ id: '11', reliability: true },
			]),
		);
		routeFetch.mockResolvedValue(routeFile('11', [90]));
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request('1');
			loader.request('2');
			loader.request('11');
			flushSync();
		});
		await vi.waitFor(() => expect(routeFetch).toHaveBeenCalledWith('11'));
		expect(routesIndexFetch).toHaveBeenCalledTimes(1);
		// 1 + 2 skipped (index false); only 11 probed.
		expect(routeFetch).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it('is race-safe: an undecided id raced ahead of the index is parked, never probe-then-discovered', async () => {
		// Hold the index open; the request must NOT probe while the flags are unknown.
		const idxGate = deferred<RoutesIndex>();
		routesIndexFetch.mockReturnValue(idxGate.promise);
		routeFetch.mockResolvedValue(routeFile('1', [90]));
		let loaderRef!: ReturnType<typeof createReliabilityLoader>;
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loaderRef = loader;
			loader.request('1'); // known undefined, raced ahead of the index
			flushSync();
		});
		// Index still in flight → the id is parked, NOT probed.
		expect(routeFetch).not.toHaveBeenCalled();
		expect(loaderRef.inFlight).toBe(0);
		// Now the index lands marking route 1 absent → it resolves to empty, still no probe.
		idxGate.resolve(routesIndex([{ id: '1', reliability: false }]));
		await vi.waitFor(() => {
			flushSync();
			expect(loaderRef.get('1').phase).toBe('empty');
		});
		expect(routeFetch).not.toHaveBeenCalled();
		cleanup();
	});

	it('treats known:null like known:false (immediate skip, no index, no probe)', async () => {
		routeFetch.mockResolvedValue(routeFile('1', [90]));
		let phase = 'idle';
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request({ id: '1', known: null });
			flushSync();
			$effect(() => {
				phase = loader.get('1').phase;
			});
		});
		await vi.waitFor(() => {
			flushSync();
			expect(phase).toBe('empty');
		});
		expect(routeFetch).not.toHaveBeenCalled();
		// known:null skips immediately — it must not even consult the index.
		expect(routesIndexFetch).not.toHaveBeenCalled();
		cleanup();
	});
});

describe('createReliabilityLoader — stop loader is NOT index-gated (no regression)', () => {
	it('(d) a bare stop id probes immediately and NEVER loads the routes_index', async () => {
		stopFetch.mockResolvedValue({
			generated_utc: '2026-06-18T00:00:00Z',
			id: 's1',
			periods: [{ grain: 'day', otp_pct: 91 }],
		} as StopReliability);
		let loaderRef!: ReturnType<typeof createReliabilityLoader>;
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('stop');
			loaderRef = loader;
			loader.request('s1'); // bare id, stop kind
			flushSync();
			// Stop probes SYNCHRONOUSLY (no async index gate) — unchanged behaviour.
			expect(loaderRef.inFlight).toBe(1);
		});
		await vi.waitFor(() => expect(stopFetch).toHaveBeenCalledWith('s1'));
		expect(stopFetch).toHaveBeenCalledTimes(1);
		// The stop loader must never touch the routes_index.
		expect(routesIndexFetch).not.toHaveBeenCalled();
		cleanup();
	});
});

describe('createReliabilityLoader — fail-soft', () => {
	it('a 404 (null) resolves to an empty no-data snapshot, never an error', async () => {
		routeFetch.mockResolvedValue(null);
		let phase = 'idle';
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request('ghost');
			flushSync();
			$effect(() => {
				phase = loader.get('ghost').phase;
			});
		});
		await vi.waitFor(() => {
			flushSync();
			expect(phase).toBe('empty');
		});
		cleanup();
	});

	it('a thrown fetch error also resolves to empty (no badge), never blocks', async () => {
		routeFetch.mockRejectedValue(new Error('network down'));
		let snap = { phase: 'idle', verdict: null as string | null };
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			loader.request('boom');
			flushSync();
			$effect(() => {
				const s = loader.get('boom');
				snap = { phase: s.phase, verdict: s.verdict };
			});
		});
		await vi.waitFor(() => {
			flushSync();
			expect(snap.phase).toBe('empty');
		});
		expect(snap.verdict).toBeNull();
		cleanup();
	});

	it('a file with no day-grain periods is empty, not a fabricated zero', async () => {
		stopFetch.mockResolvedValue({
			generated_utc: '2026-06-18T00:00:00Z',
			id: 's1',
			periods: [{ grain: 'week', otp_pct: 88 }],
		} as StopReliability);
		let snap = { phase: 'idle', otpPct: null as number | null };
		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('stop');
			loader.request('s1');
			flushSync();
			$effect(() => {
				const s = loader.get('s1');
				snap = { phase: s.phase, otpPct: s.otpPct };
			});
		});
		await vi.waitFor(() => {
			flushSync();
			expect(snap.phase).toBe('empty');
		});
		expect(snap.otpPct).toBeNull();
		cleanup();
	});
});
