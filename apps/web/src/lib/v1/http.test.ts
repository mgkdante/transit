import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// getEntityJson is the single client fetch+validate primitive. PR-6 adds a
// browser-only side effect: it captures the server's current time from the
// response `Date` (+ `Age`) headers and feeds sharedClock.noteServerEpochMs so
// every freshness readout anchors to server time. These tests cover that capture
// (Date+Age math, missing/NaN header skip, SSR no-op) without touching the
// existing fail-soft contract.

const mocks = vi.hoisted(() => ({
	browser: true,
	noteServerEpochMs: vi.fn<(ms: number) => void>(),
}));

vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	},
}));
vi.mock('$lib/stores/clock.svelte', () => ({
	sharedClock: {
		noteServerEpochMs: (ms: number) => mocks.noteServerEpochMs(ms),
	},
}));

async function loadHttp() {
	vi.resetModules();
	return import('./http');
}

const schema = z.object({ ok: z.boolean() });

/** Build a fetch-shaped fn returning a 200 JSON response with the given headers. */
function fetchWithHeaders(headers: Record<string, string>): typeof fetch {
	return vi.fn(async () =>
		Promise.resolve(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json', ...headers },
			}),
		),
	) as unknown as typeof fetch;
}

describe('getEntityJson — server-time capture', () => {
	beforeEach(() => {
		mocks.browser = true;
		mocks.noteServerEpochMs.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('notes Date + Age (cache age folded into the server-time estimate)', async () => {
		const { getEntityJson } = await loadHttp();
		const dateHeader = 'Sun, 21 Jun 2026 12:00:00 GMT';
		const fetchFn = fetchWithHeaders({ date: dateHeader, age: '12' });

		await getEntityJson('https://x/y.json', schema, 'live.test', fetchFn);

		const expected = Date.parse(dateHeader) + 12_000;
		expect(mocks.noteServerEpochMs).toHaveBeenCalledTimes(1);
		expect(mocks.noteServerEpochMs).toHaveBeenCalledWith(expected);
	});

	it('treats a missing Age header as 0', async () => {
		const { getEntityJson } = await loadHttp();
		const dateHeader = 'Sun, 21 Jun 2026 12:00:00 GMT';
		const fetchFn = fetchWithHeaders({ date: dateHeader });

		await getEntityJson('https://x/y.json', schema, 'live.test', fetchFn);

		expect(mocks.noteServerEpochMs).toHaveBeenCalledWith(Date.parse(dateHeader));
	});

	it('does not call noteServerEpochMs without a Date header', async () => {
		const { getEntityJson } = await loadHttp();
		const fetchFn = fetchWithHeaders({});

		await getEntityJson('https://x/y.json', schema, 'live.test', fetchFn);

		expect(mocks.noteServerEpochMs).not.toHaveBeenCalled();
	});

	it('does not call noteServerEpochMs on an unparseable Date header', async () => {
		const { getEntityJson } = await loadHttp();
		const fetchFn = fetchWithHeaders({ date: 'not-a-date' });

		await getEntityJson('https://x/y.json', schema, 'live.test', fetchFn);

		expect(mocks.noteServerEpochMs).not.toHaveBeenCalled();
	});

	it('SSR (no browser) never captures server time', async () => {
		mocks.browser = false;
		const { getEntityJson } = await loadHttp();
		const fetchFn = fetchWithHeaders({ date: 'Sun, 21 Jun 2026 12:00:00 GMT', age: '5' });

		await getEntityJson('https://x/y.json', schema, 'live.test', fetchFn);

		expect(mocks.noteServerEpochMs).not.toHaveBeenCalled();
	});

	it('still returns the parsed body alongside the capture', async () => {
		const { getEntityJson } = await loadHttp();
		const fetchFn = fetchWithHeaders({ date: 'Sun, 21 Jun 2026 12:00:00 GMT' });

		const out = await getEntityJson('https://x/y.json', schema, 'live.test', fetchFn);

		expect(out).toEqual({ ok: true });
	});
});
