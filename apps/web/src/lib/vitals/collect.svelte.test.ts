import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the env flag so each test controls PUBLIC_VITALS_ENABLED. We reassign the
// live object's property per-test (the module reads env.PUBLIC_VITALS_ENABLED at
// CALL time via $lib/site/config-style dynamic access, so a mutable stub works).
const publicEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$app/environment', () => ({ browser: true }));

// Capture the web-vitals handlers so we can drive them + assert registration.
const handlers = {
	onCLS: vi.fn(),
	onFCP: vi.fn(),
	onINP: vi.fn(),
	onLCP: vi.fn(),
	onTTFB: vi.fn(),
};
vi.mock('web-vitals', () => handlers);

async function freshStart() {
	// Reset the module-level `started` guard between tests.
	vi.resetModules();
	const mod = await import('./collect');
	return mod;
}

/** Wait until startVitals' dynamic import('web-vitals') has settled + wired up. */
async function awaitRegistration() {
	await vi.waitFor(() => {
		expect(handlers.onLCP).toHaveBeenCalled();
	});
}

beforeEach(() => {
	for (const fn of Object.values(handlers)) fn.mockReset();
	publicEnv.PUBLIC_VITALS_ENABLED = undefined;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('startVitals — inert when the flag is off', () => {
	it('registers NO handlers and opens NO network when the flag is unset', async () => {
		const sendBeacon = vi.fn(() => true);
		vi.stubGlobal('navigator', { sendBeacon });

		const { startVitals } = await freshStart();
		const dispose = startVitals();
		// give a microtask in case a dynamic import slipped through
		await Promise.resolve();

		expect(handlers.onLCP).not.toHaveBeenCalled();
		expect(handlers.onCLS).not.toHaveBeenCalled();
		expect(sendBeacon).not.toHaveBeenCalled();
		expect(typeof dispose).toBe('function');
		dispose();
	});

	it('stays inert for any value other than exactly "true"', async () => {
		publicEnv.PUBLIC_VITALS_ENABLED = 'TRUE';
		const { startVitals, vitalsEnabled } = await freshStart();
		expect(vitalsEnabled()).toBe(false);
		startVitals();
		await Promise.resolve();
		expect(handlers.onLCP).not.toHaveBeenCalled();
	});
});

describe('startVitals — active when the flag is on', () => {
	beforeEach(() => {
		publicEnv.PUBLIC_VITALS_ENABLED = 'true';
	});

	it('registers all five web-vitals handlers', async () => {
		const { startVitals } = await freshStart();
		startVitals();
		await awaitRegistration(); // resolve the dynamic import

		expect(handlers.onCLS).toHaveBeenCalledTimes(1);
		expect(handlers.onFCP).toHaveBeenCalledTimes(1);
		expect(handlers.onINP).toHaveBeenCalledTimes(1);
		expect(handlers.onLCP).toHaveBeenCalledTimes(1);
		expect(handlers.onTTFB).toHaveBeenCalledTimes(1);
	});

	it('beacons a batched, path-only, PII-free payload on visibilitychange->hidden', async () => {
		const sendBeacon = vi.fn((..._args: unknown[]) => true);
		vi.stubGlobal('navigator', { sendBeacon, connection: { effectiveType: '4g' } });
		// Strip query/hash to prove path-only.
		Object.defineProperty(window, 'location', {
			value: { pathname: '/lines/11' },
			writable: true,
		});

		const { startVitals } = await freshStart();
		startVitals();
		await awaitRegistration();

		// Drive two metrics through their registered callbacks.
		const lcpCb = handlers.onLCP.mock.calls[0][0];
		const clsCb = handlers.onCLS.mock.calls[0][0];
		lcpCb({
			name: 'LCP',
			value: 1500,
			id: 'lcp-1',
			rating: 'good',
			navigationType: 'navigate',
		});
		clsCb({
			name: 'CLS',
			value: 0.03,
			id: 'cls-1',
			rating: 'good',
			navigationType: 'navigate',
		});

		// Flush via visibilitychange -> hidden.
		Object.defineProperty(document, 'visibilityState', {
			value: 'hidden',
			configurable: true,
		});
		document.dispatchEvent(new Event('visibilitychange'));

		expect(sendBeacon).toHaveBeenCalledTimes(1); // ONE batched beacon
		const [path, blob] = sendBeacon.mock.calls[0] as [string, Blob];
		expect(path).toBe('/api/vitals');
		const body = JSON.parse(await blob.text());
		expect(body.samples).toHaveLength(2);
		const lcp = body.samples.find((s: { name: string }) => s.name === 'LCP');
		expect(lcp).toMatchObject({ name: 'LCP', value: 1500, path: '/lines/11', conn: '4g' });
		// No PII / no full URL: only the schema fields, path has no query string.
		expect(JSON.stringify(body)).not.toContain('?');
		expect(Object.keys(lcp).sort()).toEqual(
			['conn', 'id', 'name', 'navType', 'path', 'rating', 'value'].sort(),
		);
	});

	it('falls back to a keepalive fetch when sendBeacon is unavailable', async () => {
		const fetchMock = vi.fn((..._args: unknown[]) =>
			Promise.resolve(new Response(null, { status: 204 })),
		);
		vi.stubGlobal('navigator', {}); // no sendBeacon
		vi.stubGlobal('fetch', fetchMock);
		Object.defineProperty(window, 'location', {
			value: { pathname: '/' },
			writable: true,
		});

		const { startVitals } = await freshStart();
		startVitals();
		await awaitRegistration();

		handlers.onTTFB.mock.calls[0][0]({
			name: 'TTFB',
			value: 80,
			id: 'ttfb-1',
			rating: 'good',
			navigationType: 'navigate',
		});

		window.dispatchEvent(new Event('pagehide'));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/vitals');
		expect(init.method).toBe('POST');
		expect(init.keepalive).toBe(true);
	});

	it('flushes at most once (single-shot on unload)', async () => {
		const sendBeacon = vi.fn(() => true);
		vi.stubGlobal('navigator', { sendBeacon });
		Object.defineProperty(window, 'location', { value: { pathname: '/' }, writable: true });

		const { startVitals } = await freshStart();
		startVitals();
		await awaitRegistration();

		handlers.onLCP.mock.calls[0][0]({
			name: 'LCP',
			value: 1,
			id: 'lcp-x',
			rating: 'good',
			navigationType: 'navigate',
		});

		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('pagehide'));

		expect(sendBeacon).toHaveBeenCalledTimes(1);
	});
});
