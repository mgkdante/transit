import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverV1Context } from './serverContext';

function fetchSpy(): typeof fetch {
	return vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
}

function observe(promise: Promise<Response>): {
	settled: boolean;
	response?: Response;
	error?: unknown;
} {
	const state: { settled: boolean; response?: Response; error?: unknown } = { settled: false };
	void promise.then(
		(response) => {
			state.settled = true;
			state.response = response;
		},
		(error: unknown) => {
			state.settled = true;
			state.error = error;
		},
	);
	return state;
}

async function settle(): Promise<void> {
	for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe('serverV1Context', () => {
	it('prefers the direct R2 bucket over the quota-bearing DATA Worker binding', async () => {
		const requestFetch = fetchSpy();
		const workerFetch = fetchSpy();
		const bucketGet = vi.fn(async () => ({
			body: JSON.stringify({ id: '24' }),
			httpEtag: '"route-24"',
			writeHttpMetadata(headers: Headers) {
				headers.set('content-type', 'application/json');
			},
		}));
		const ctx = serverV1Context({
			fetch: requestFetch,
			locals: { v1Cache: new Map() },
			platform: {
				env: {
					SNAPSHOTS: { get: bucketGet },
					DATA: { fetch: workerFetch },
				},
			},
			url: new URL('https://transit.yesid.dev/lines/24'),
		});

		const response = await ctx.fetch?.('https://data.yesid.dev/v1/stm/static/routes/24.json');

		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual({ id: '24' });
		expect(bucketGet).toHaveBeenCalledWith('v1/stm/static/routes/24.json', expect.any(Object));
		expect(workerFetch).not.toHaveBeenCalled();
		expect(requestFetch).not.toHaveBeenCalled();
	});

	it('retries through the compatibility Worker only when the direct R2 binding throws', async () => {
		const workerFetch = fetchSpy();
		const bucketGet = vi.fn(async () => {
			throw new Error('temporary R2 binding failure');
		});
		const ctx = serverV1Context({
			fetch: fetchSpy(),
			locals: {},
			platform: {
				env: {
					SNAPSHOTS: { get: bucketGet },
					DATA: { fetch: workerFetch },
				},
			},
			url: new URL('https://transit.yesid.dev/network'),
		});

		const response = await ctx.fetch?.('https://data.yesid.dev/v1/stm/manifest.json');

		expect(response?.status).toBe(200);
		expect(bucketGet).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(workerFetch).mock.calls[0][0])).toBe(
			'https://transit.yesid.dev/data/v1/stm/manifest.json',
		);
	});

	it.each([
		['DOMException AbortError', new DOMException('Aborted', 'AbortError')],
		['DOMException TimeoutError', new DOMException('Timed out', 'TimeoutError')],
		['Error AbortError', Object.assign(new Error('Aborted'), { name: 'AbortError' })],
		['Error TimeoutError', Object.assign(new Error('Timed out'), { name: 'TimeoutError' })],
	])('does not retry %s through the compatibility Worker', async (_name, failure) => {
		const workerFetch = fetchSpy();
		const bucketGet = vi.fn(async () => {
			throw failure;
		});
		const ctx = serverV1Context({
			fetch: fetchSpy(),
			locals: {},
			platform: {
				env: {
					SNAPSHOTS: { get: bucketGet },
					DATA: { fetch: workerFetch },
				},
			},
			url: new URL('https://transit.yesid.dev/network'),
		});

		const caught = await ctx.fetch?.('https://data.yesid.dev/v1/stm/manifest.json').then(
			() => undefined,
			(error: unknown) => error,
		);

		expect.soft(caught).toBe(failure);
		expect.soft(workerFetch).not.toHaveBeenCalled();
	});

	it('uses the Cloudflare DATA binding and preserves the per-request cache when available', async () => {
		const requestFetch = fetchSpy();
		const bindingFetch = fetchSpy();
		const cache = new Map<string, unknown>();
		const ctx = serverV1Context({
			fetch: requestFetch,
			locals: { v1Cache: cache },
			platform: { env: { DATA: { fetch: bindingFetch } } },
			url: new URL('https://transit.yesid.dev/lines/24'),
		});

		await ctx.fetch?.('/data/v1/stm/routes/24.json');

		expect(bindingFetch).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(bindingFetch).mock.calls[0][0])).toBe(
			'https://transit.yesid.dev/data/v1/stm/routes/24.json',
		);
		expect(requestFetch).not.toHaveBeenCalled();
		expect(ctx.cache).toBe(cache);
	});

	it('maps the public direct-R2 URL back to the compatibility Worker route', async () => {
		const workerFetch = fetchSpy();
		const ctx = serverV1Context({
			fetch: fetchSpy(),
			locals: {},
			platform: { env: { DATA: { fetch: workerFetch } } },
			url: new URL('https://transit.yesid.dev/network'),
		});

		await ctx.fetch?.('https://data.yesid.dev/v1/stm/manifest.json');

		expect(String(vi.mocked(workerFetch).mock.calls[0][0])).toBe(
			'https://transit.yesid.dev/data/v1/stm/manifest.json',
		);
	});

	it('falls back to the request fetch when the DATA binding is absent', async () => {
		const requestFetch = fetchSpy();
		const ctx = serverV1Context({
			fetch: requestFetch,
			locals: {},
			platform: undefined,
			url: new URL('http://localhost:5173/stop/1234'),
		});

		await ctx.fetch?.('/data/v1/stm/stops/1234.json');

		expect(requestFetch).toHaveBeenCalledWith(
			'/data/v1/stm/stops/1234.json',
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	describe('10-second request deadline', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		it('bounds signal-ignoring direct R2 and blocks fallback after a late failure', async () => {
			let rejectLate!: (error: Error) => void;
			const bucketGet = vi.fn(
				() =>
					new Promise<never>((_resolve, reject) => {
						rejectLate = reject;
					}),
			);
			const workerFetch = fetchSpy();
			const ctx = serverV1Context({
				fetch: fetchSpy(),
				locals: {},
				platform: { env: { SNAPSHOTS: { get: bucketGet }, DATA: { fetch: workerFetch } } },
				url: new URL('https://transit.yesid.dev/network'),
			});

			const state = observe(ctx.fetch!('https://data.yesid.dev/v1/stm/manifest.json'));
			await settle();
			await vi.advanceTimersByTimeAsync(9_999);
			expect.soft(state.settled).toBe(false);

			await vi.advanceTimersByTimeAsync(1);
			await settle();

			expect.soft(state.settled).toBe(true);
			expect.soft(state.error).toBeInstanceOf(DOMException);
			expect.soft((state.error as DOMException | undefined)?.name).toBe('TimeoutError');
			expect.soft(workerFetch).not.toHaveBeenCalled();
			expect.soft(vi.getTimerCount()).toBe(0);

			rejectLate(new Error('late direct R2 failure'));
			await settle();

			expect.soft(workerFetch).not.toHaveBeenCalled();
		});

		it('shares one deadline across direct R2 and a hanging compatibility fallback', async () => {
			const bucketGet = vi.fn(
				() =>
					new Promise<never>((_resolve, reject) => {
						setTimeout(() => reject(new Error('temporary R2 failure')), 6_000);
					}),
			);
			const workerFetch = vi.fn(
				(_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
					new Promise<Response>(() => {}),
			);
			const ctx = serverV1Context({
				fetch: fetchSpy(),
				locals: {},
				platform: {
					env: { SNAPSHOTS: { get: bucketGet }, DATA: { fetch: workerFetch as typeof fetch } },
				},
				url: new URL('https://transit.yesid.dev/network'),
			});

			const state = observe(ctx.fetch!('https://data.yesid.dev/v1/stm/manifest.json'));
			await vi.advanceTimersByTimeAsync(6_000);
			await settle();

			expect.soft(workerFetch).toHaveBeenCalledOnce();
			const forwardedSignal = workerFetch.mock.calls[0]?.[1]?.signal;
			expect.soft(forwardedSignal).toBeInstanceOf(AbortSignal);
			expect.soft(forwardedSignal?.aborted).toBe(false);

			await vi.advanceTimersByTimeAsync(3_999);
			expect.soft(state.settled).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await settle();

			expect.soft(state.settled).toBe(true);
			expect.soft((state.error as Error | undefined)?.name).toBe('TimeoutError');
			expect.soft(forwardedSignal?.aborted).toBe(true);
			expect.soft((forwardedSignal?.reason as Error | undefined)?.name).toBe('TimeoutError');
			expect.soft(vi.getTimerCount()).toBe(0);
		});

		it.each(['DATA binding', 'request fetch'] as const)(
			'bounds the signal-ignoring %s transport',
			async (transportKind) => {
				const transport = vi.fn(
					(_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
						new Promise<Response>(() => {}),
				);
				const ctx = serverV1Context({
					fetch: transport as typeof fetch,
					locals: {},
					platform:
						transportKind === 'DATA binding'
							? { env: { DATA: { fetch: transport as typeof fetch } } }
							: undefined,
					url: new URL('https://transit.yesid.dev/network'),
				});

				const state = observe(ctx.fetch!('https://data.yesid.dev/v1/stm/manifest.json'));
				await settle();
				const forwardedSignal = transport.mock.calls[0]?.[1]?.signal;
				expect.soft(forwardedSignal).toBeInstanceOf(AbortSignal);
				expect.soft(forwardedSignal?.aborted).toBe(false);

				await vi.advanceTimersByTimeAsync(10_000);
				await settle();

				expect.soft(state.settled).toBe(true);
				expect.soft((state.error as Error | undefined)?.name).toBe('TimeoutError');
				expect.soft(forwardedSignal?.aborted).toBe(true);
				expect.soft(vi.getTimerCount()).toBe(0);
			},
		);

		it('lets caller abort win with its exact reason and never starts fallback', async () => {
			const bucketGet = vi.fn(() => new Promise<never>(() => {}));
			const workerFetch = fetchSpy();
			const caller = new AbortController();
			const reason = Object.assign(new Error('caller ended the request'), { name: 'AbortError' });
			const ctx = serverV1Context({
				fetch: fetchSpy(),
				locals: {},
				platform: { env: { SNAPSHOTS: { get: bucketGet }, DATA: { fetch: workerFetch } } },
				url: new URL('https://transit.yesid.dev/network'),
			});

			const state = observe(
				ctx.fetch!('https://data.yesid.dev/v1/stm/manifest.json', { signal: caller.signal }),
			);
			await settle();
			caller.abort(reason);
			await settle();

			expect.soft(state.settled).toBe(true);
			expect.soft(state.error).toBe(reason);
			expect.soft(workerFetch).not.toHaveBeenCalled();
			expect.soft(vi.getTimerCount()).toBe(0);
		});

		it('rejects an already-aborted caller without starting a transport or timer', async () => {
			const transport = fetchSpy();
			const caller = new AbortController();
			const reason = Object.assign(new Error('request was already closed'), { name: 'AbortError' });
			caller.abort(reason);
			const ctx = serverV1Context({
				fetch: transport,
				locals: {},
				platform: { env: { DATA: { fetch: transport } } },
				url: new URL('https://transit.yesid.dev/network'),
			});

			const state = observe(
				ctx.fetch!('https://data.yesid.dev/v1/stm/manifest.json', { signal: caller.signal }),
			);
			await settle();

			expect.soft(state.settled).toBe(true);
			expect.soft(state.error).toBe(reason);
			expect.soft(transport).not.toHaveBeenCalled();
			expect.soft(vi.getTimerCount()).toBe(0);
		});

		it('preserves Request signal inheritance and init override semantics', async () => {
			const transport = vi.fn(
				(_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
					new Promise<Response>(() => {}),
			);
			const ctx = serverV1Context({
				fetch: transport as typeof fetch,
				locals: {},
				platform: undefined,
				url: new URL('https://transit.yesid.dev/network'),
			});

			const inherited = new AbortController();
			const inheritedReason = new Error('request signal');
			const inheritedState = observe(
				ctx.fetch!(
					new Request('https://data.yesid.dev/v1/stm/manifest.json', {
						signal: inherited.signal,
					}),
				),
			);
			await settle();
			inherited.abort(inheritedReason);
			await settle();
			expect.soft(inheritedState.error).toBe(inheritedReason);

			const requestController = new AbortController();
			const initController = new AbortController();
			const requestReason = new Error('request should be overridden');
			const initReason = new Error('init signal');
			const overrideState = observe(
				ctx.fetch!(
					new Request('https://data.yesid.dev/v1/stm/manifest.json', {
						signal: requestController.signal,
					}),
					{ signal: initController.signal },
				),
			);
			await settle();
			requestController.abort(requestReason);
			await settle();
			expect.soft(overrideState.settled).toBe(false);
			initController.abort(initReason);
			await settle();
			expect.soft(overrideState.error).toBe(initReason);

			const clearedController = new AbortController();
			const clearedState = observe(
				ctx.fetch!(
					new Request('https://data.yesid.dev/v1/stm/manifest.json', {
						signal: clearedController.signal,
					}),
					{ signal: null },
				),
			);
			await settle();
			clearedController.abort(new Error('cleared Request signal'));
			await settle();
			expect.soft(clearedState.settled).toBe(false);
			await vi.advanceTimersByTimeAsync(10_000);
			await settle();
			expect.soft((clearedState.error as Error | undefined)?.name).toBe('TimeoutError');
			expect.soft(vi.getTimerCount()).toBe(0);
		});

		it('preserves Request URL and init method, headers, body, and signal overrides', async () => {
			let effectiveRequest: Request | undefined;
			let effectiveBody: string | undefined;
			const requestFetch = vi.fn(
				async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
					effectiveRequest = new Request(input, init);
					effectiveBody = await effectiveRequest.text();
					return new Response('{}', { status: 200 });
				},
			);
			const ctx = serverV1Context({
				fetch: requestFetch as typeof fetch,
				locals: {},
				platform: undefined,
				url: new URL('https://transit.yesid.dev/network'),
			});
			const input = new Request('https://data.yesid.dev/v1/stm/manifest.json?source=base', {
				method: 'POST',
				headers: { 'x-base': 'yes' },
				body: 'base body',
			});

			await ctx.fetch!(input, {
				method: 'PUT',
				headers: { 'x-init': 'yes' },
				body: 'override body',
			});

			expect
				.soft(effectiveRequest?.url)
				.toBe('https://data.yesid.dev/v1/stm/manifest.json?source=base');
			expect.soft(effectiveRequest?.method).toBe('PUT');
			expect.soft(effectiveRequest?.headers.get('x-init')).toBe('yes');
			expect.soft(effectiveRequest?.headers.has('x-base')).toBe(false);
			expect.soft(effectiveBody).toBe('override body');
			expect.soft(effectiveRequest?.signal).toBeInstanceOf(AbortSignal);
			expect.soft(effectiveRequest?.signal.aborted).toBe(false);
			expect.soft(vi.getTimerCount()).toBe(0);
		});

		it('cleans up the caller listener and timer after success and immediate failure', async () => {
			const failure = new Error('transport failed immediately');
			const forwardedSignals: AbortSignal[] = [];
			const transport = vi
				.fn(
					(
						_input: Parameters<typeof fetch>[0],
						init?: Parameters<typeof fetch>[1],
					): Promise<Response> => {
						forwardedSignals.push(init!.signal!);
						return Promise.reject(failure);
					},
				)
				.mockImplementationOnce(
					(_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
						forwardedSignals.push(init!.signal!);
						return Promise.resolve(new Response('readable after caller abort'));
					},
				);
			const ctx = serverV1Context({
				fetch: transport as typeof fetch,
				locals: {},
				platform: undefined,
				url: new URL('https://transit.yesid.dev/network'),
			});

			const successCaller = new AbortController();
			const successRemove = vi.spyOn(successCaller.signal, 'removeEventListener');
			const response = await ctx.fetch!('https://data.yesid.dev/v1/stm/manifest.json', {
				signal: successCaller.signal,
			});
			expect.soft(successRemove).toHaveBeenCalledWith('abort', expect.any(Function));
			expect.soft(vi.getTimerCount()).toBe(0);
			successCaller.abort(new Error('too late'));
			expect.soft(forwardedSignals[0]?.aborted).toBe(false);
			expect.soft(await response.text()).toBe('readable after caller abort');

			const failureCaller = new AbortController();
			const failureRemove = vi.spyOn(failureCaller.signal, 'removeEventListener');
			const caught = await ctx.fetch!('https://data.yesid.dev/v1/stm/manifest.json', {
				signal: failureCaller.signal,
			}).then(
				() => undefined,
				(error: unknown) => error,
			);
			expect.soft(caught).toBe(failure);
			expect.soft(failureRemove).toHaveBeenCalledWith('abort', expect.any(Function));
			expect.soft(vi.getTimerCount()).toBe(0);
			failureCaller.abort(new Error('also too late'));
			expect.soft(forwardedSignals[1]?.aborted).toBe(false);
		});
	});
});
