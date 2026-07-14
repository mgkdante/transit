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

describe('getEntityJsonWithBytes — exact response-body transport', () => {
	beforeEach(() => {
		mocks.browser = true;
		mocks.noteServerEpochMs.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('reads arrayBuffer exactly once, never calls json(), and preserves the exact UTF-8 bytes', async () => {
		const { getEntityJsonWithBytes } = await loadHttp();
		const bytes = new TextEncoder().encode(' {"ok":true,"label":"Montréal 🚇"}\n');
		const response = new Response(bytes, {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
		const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
		const jsonBody = vi.spyOn(response, 'json');
		const fetchFn = vi.fn(async () => response) as unknown as typeof fetch;
		const rawSchema = z.object({ ok: z.boolean(), label: z.string() });

		const result = await getEntityJsonWithBytes(
			'https://x/history.json',
			rawSchema,
			'historic.partition',
			fetchFn,
		);

		expect(result?.value).toEqual({ ok: true, label: 'Montréal 🚇' });
		expect(result?.bytes).toEqual(bytes);
		expect(arrayBuffer).toHaveBeenCalledTimes(1);
		expect(jsonBody).not.toHaveBeenCalled();
	});

	it('returns undefined on 404 without consuming either response body API', async () => {
		const { getEntityJsonWithBytes } = await loadHttp();
		const response = new Response('not json', { status: 404 });
		const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
		const jsonBody = vi.spyOn(response, 'json');

		await expect(
			getEntityJsonWithBytes(
				'https://x/missing.json',
				schema,
				'historic.partition',
				vi.fn(async () => response) as unknown as typeof fetch,
			),
		).resolves.toBeUndefined();
		expect(arrayBuffer).not.toHaveBeenCalled();
		expect(jsonBody).not.toHaveBeenCalled();
	});

	it('forwards cache in the browser, omits it during SSR, and always forwards the signal', async () => {
		const controller = new AbortController();
		const browserFetch = vi.fn(
			async () => new Response('{"ok":true}', { status: 200 }),
		) as unknown as typeof fetch;
		let http = await loadHttp();

		await http.getEntityJsonWithBytes(
			'https://x/browser.json',
			schema,
			'historic.partition',
			browserFetch,
			{ cache: 'reload', signal: controller.signal },
		);
		expect(browserFetch).toHaveBeenCalledWith(
			'https://x/browser.json',
			expect.objectContaining({ cache: 'reload', signal: controller.signal }),
		);

		mocks.browser = false;
		const ssrFetch = vi.fn(
			async () => new Response('{"ok":true}', { status: 200 }),
		) as unknown as typeof fetch;
		http = await loadHttp();
		await http.getEntityJsonWithBytes(
			'https://x/ssr.json',
			schema,
			'historic.partition',
			ssrFetch,
			{ cache: 'reload', signal: controller.signal },
		);
		expect(ssrFetch).toHaveBeenCalledWith(
			'https://x/ssr.json',
			expect.objectContaining({ cache: undefined, signal: controller.signal }),
		);
	});

	it('propagates request and body AbortError instances unchanged', async () => {
		const { getEntityJsonWithBytes } = await loadHttp();
		const requestAbort = new DOMException('request stopped', 'AbortError');
		const bodyAbort = new DOMException('body stopped', 'AbortError');

		await expect(
			getEntityJsonWithBytes(
				'https://x/request-abort.json',
				schema,
				'historic.partition',
				vi.fn(async () => Promise.reject(requestAbort)) as unknown as typeof fetch,
			),
		).rejects.toBe(requestAbort);

		const response = new Response('{"ok":true}', { status: 200 });
		vi.spyOn(response, 'arrayBuffer').mockRejectedValue(bodyAbort);
		await expect(
			getEntityJsonWithBytes(
				'https://x/body-abort.json',
				schema,
				'historic.partition',
				vi.fn(async () => response) as unknown as typeof fetch,
			),
		).rejects.toBe(bodyAbort);
	});

	it('labels invalid JSON and schema drift without changing HTTP error semantics', async () => {
		const { getEntityJsonWithBytes } = await loadHttp();
		const fetchBody = (body: string, status = 200) =>
			vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

		await expect(
			getEntityJsonWithBytes(
				'https://x/broken.json',
				schema,
				'historic.partition',
				fetchBody('{"ok":'),
			),
		).rejects.toThrow('[v1.historic.partition] invalid JSON from https://x/broken.json');
		await expect(
			getEntityJsonWithBytes(
				'https://x/drift.json',
				schema,
				'historic.partition',
				fetchBody('{"ok":"yes"}'),
			),
		).rejects.toThrow('[adapter.historic.partition]');
		await expect(
			getEntityJsonWithBytes(
				'https://x/failed.json',
				schema,
				'historic.partition',
				fetchBody('{}', 503),
			),
		).rejects.toThrow('[v1.historic.partition] HTTP 503');
	});

	it('rejects invalid UTF-8 instead of replacement-decoding a different JSON value', async () => {
		const { getEntityJsonWithBytes } = await loadHttp();
		const prefix = new TextEncoder().encode('{"ok":true,"label":"');
		const suffix = new TextEncoder().encode('"}');
		const bytes = new Uint8Array(prefix.byteLength + 1 + suffix.byteLength);
		bytes.set(prefix);
		bytes[prefix.byteLength] = 0xff;
		bytes.set(suffix, prefix.byteLength + 1);
		const rawSchema = z.object({ ok: z.boolean(), label: z.string() });

		await expect(
			getEntityJsonWithBytes(
				'https://x/not-utf8.json',
				rawSchema,
				'historic.partition',
				vi.fn(async () => new Response(bytes)) as unknown as typeof fetch,
			),
		).rejects.toThrow('[v1.historic.partition] invalid JSON from https://x/not-utf8.json');
	});

	it('computes the standard SHA-256 digest for exact bytes', async () => {
		const { sha256Hex } = await loadHttp();

		await expect(sha256Hex(new TextEncoder().encode('abc'))).resolves.toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});
});
