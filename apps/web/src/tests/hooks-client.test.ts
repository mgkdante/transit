import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	clock: { kind: 'clock' },
	refresh: { kind: 'refresh' },
	configureRuntime: vi.fn(),
	configureUi: vi.fn(),
	preciseClock: vi.fn((clock: unknown) => ({ precise: clock })),
}));

vi.mock('@yesid/ui/state', async (importOriginal) => ({
	...(await importOriginal<typeof import('@yesid/ui/state')>()),
	clock: mocks.clock,
}));
vi.mock('#lib/stores/index.ts', () => ({ dataRefresh: mocks.refresh }));
vi.mock('#lib/v1/runtime.ts', () => ({ configureV1Runtime: mocks.configureRuntime }));
vi.mock('#lib/ui/configure.ts', () => ({ configureTransitUi: mocks.configureUi }));
vi.mock('#lib/v1/preciseClock.ts', () => ({ preciseServerClock: mocks.preciseClock }));

import { init } from '../hooks.client';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

function initializeFetch(response: Response) {
	const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
	vi.stubGlobal('window', { fetch: fetcher, location: { origin: 'https://transit.test' } });
	init();
	return fetcher;
}

describe('client init', () => {
	it('wires app runtime stores into dependency-free v1 ports', () => {
		vi.stubGlobal('window', { fetch: vi.fn(), location: { origin: 'https://transit.test' } });
		init();

		// Live ages read the real time, not the shared clock's last tick.
		expect(mocks.preciseClock).toHaveBeenCalledWith(mocks.clock);
		expect(mocks.configureRuntime).toHaveBeenCalledWith({
			clock: { precise: mocks.clock },
			refresh: mocks.refresh,
		});
		expect(mocks.configureUi).toHaveBeenCalledOnce();
	});

	for (const dataPath of ['/map/__data.json', '/trip/T1.html__data.json']) {
		it.each([
			['truncated', '{"type":"data","nodes":[]'],
			['malformed', '{"type":"data","nodes":[]}\ninvalid'],
		])(`installs fixed-JSON protection for ${dataPath}: %s`, async (_kind, body) => {
			const response = new Response(body, { headers: { 'content-type': 'application/json' } });
			initializeFetch(response);
			await expect(window.fetch(`https://transit.test${dataPath}`)).rejects.toThrow(SyntaxError);
		});
	}

	it('leaves a non-data response untouched after init', async () => {
		const response = new Response('not JSON', { headers: { 'content-type': 'application/json' } });
		const fetcher = initializeFetch(response);
		expect(await window.fetch('https://transit.test/api/example')).toBe(response);
		expect(response.bodyUsed).toBe(false);
		expect(fetcher).toHaveBeenCalledOnce();
	});
});
