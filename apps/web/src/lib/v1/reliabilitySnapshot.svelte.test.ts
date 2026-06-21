import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import type { RouteReliability, StopReliability } from './schemas';

// Hoisted fetch spies the loader reaches through the repositories barrel.
const routeFetch = vi.fn<(id: string) => Promise<RouteReliability | null>>();
const stopFetch = vi.fn<(id: string) => Promise<StopReliability | null>>();

vi.mock('./repositories', () => ({
	getRouteReliability: (id: string) => routeFetch(id),
	getStopReliability: (id: string) => stopFetch(id),
}));

import { createReliabilityLoader } from './reliabilitySnapshot.svelte';

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

		const cleanup = $effect.root(() => {
			const loader = createReliabilityLoader('route');
			// Request 8 ids at once; only 4 may be in flight.
			for (let i = 0; i < 8; i++) loader.request(`r${i}`);
			flushSync();
			expect(loader.inFlight).toBe(4);
			expect(routeFetch).toHaveBeenCalledTimes(4);

			// Resolve two — two queued ones should start.
			gates.get('r0')!.resolve(routeFile('r0', [90]));
			gates.get('r1')!.resolve(routeFile('r1', [90]));
		});
		await vi.waitFor(() => expect(routeFetch).toHaveBeenCalledTimes(6));
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
