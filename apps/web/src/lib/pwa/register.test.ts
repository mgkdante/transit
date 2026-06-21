import { describe, expect, it, vi } from 'vitest';
import {
	fetchKillFlag,
	runServiceWorkerLifecycle,
	teardownServiceWorkers,
	type RegisterEnv,
} from './register';

function fakeFetch(body: unknown, ok = true): typeof fetch {
	return vi.fn(
		async () =>
			({
				ok,
				json: async () => body,
			}) as Response,
	) as unknown as typeof fetch;
}

function failingFetch(): typeof fetch {
	return vi.fn(async () => {
		throw new Error('offline');
	}) as unknown as typeof fetch;
}

function fakeServiceWorker(registrations: { unregister: () => Promise<boolean> }[] = []) {
	return {
		register: vi.fn(async () => ({}) as ServiceWorkerRegistration),
		getRegistrations: vi.fn(async () => registrations as unknown as ServiceWorkerRegistration[]),
	} as unknown as ServiceWorkerContainer;
}

function fakeCaches(keys: string[] = []) {
	return {
		keys: vi.fn(async () => keys),
		delete: vi.fn(async () => true),
	} as unknown as CacheStorage;
}

const baseEnv = (over: Partial<RegisterEnv> = {}): RegisterEnv => ({
	browser: true,
	production: true,
	secureContext: true,
	serviceWorker: fakeServiceWorker(),
	caches: fakeCaches(),
	fetch: fakeFetch({ disabled: false }),
	...over,
});

describe('fetchKillFlag', () => {
	it('returns the parsed flag on a 200', async () => {
		expect(await fetchKillFlag(fakeFetch({ disabled: true }))).toEqual({ disabled: true });
	});

	it('returns null on a non-OK response', async () => {
		expect(await fetchKillFlag(fakeFetch({ disabled: true }, false))).toBeNull();
	});

	it('returns null when the fetch throws (offline)', async () => {
		expect(await fetchKillFlag(failingFetch())).toBeNull();
	});
});

describe('teardownServiceWorkers', () => {
	it('unregisters all SWs and deletes all caches', async () => {
		const unregister = vi.fn(async () => true);
		const sw = fakeServiceWorker([{ unregister }]);
		const cs = fakeCaches(['transit-shell-1', 'transit-shell-2']);
		await teardownServiceWorkers(baseEnv({ serviceWorker: sw, caches: cs }));
		expect(unregister).toHaveBeenCalledTimes(1);
		expect(cs.delete as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
	});

	it('never throws when APIs are absent', async () => {
		await expect(
			teardownServiceWorkers(baseEnv({ serviceWorker: undefined, caches: undefined })),
		).resolves.toBeUndefined();
	});
});

describe('runServiceWorkerLifecycle', () => {
	it('registers when eligible and not killed', async () => {
		const sw = fakeServiceWorker();
		const result = await runServiceWorkerLifecycle(baseEnv({ serviceWorker: sw }));
		expect(result).toBe('registered');
		expect(sw.register).toHaveBeenCalledWith('/service-worker.js', { type: 'module' });
	});

	it('KILLS (tears down, does not register) when the flag says disabled:true', async () => {
		const unregister = vi.fn(async () => true);
		const sw = fakeServiceWorker([{ unregister }]);
		const result = await runServiceWorkerLifecycle(
			baseEnv({ serviceWorker: sw, fetch: fakeFetch({ disabled: true }) }),
		);
		expect(result).toBe('killed');
		expect(unregister).toHaveBeenCalledTimes(1);
		expect(sw.register).not.toHaveBeenCalled();
	});

	it('skips in dev (production=false) and tears down any stale SW', async () => {
		const unregister = vi.fn(async () => true);
		const sw = fakeServiceWorker([{ unregister }]);
		const result = await runServiceWorkerLifecycle(
			baseEnv({ production: false, serviceWorker: sw }),
		);
		expect(result).toBe('skipped');
		expect(sw.register).not.toHaveBeenCalled();
		// Stale prod SW from a prior visit is torn down even in dev.
		expect(unregister).toHaveBeenCalledTimes(1);
	});

	it('skips on insecure context', async () => {
		const sw = fakeServiceWorker();
		const result = await runServiceWorkerLifecycle(
			baseEnv({ secureContext: false, serviceWorker: sw }),
		);
		expect(result).toBe('skipped');
		expect(sw.register).not.toHaveBeenCalled();
	});

	it('skips during SSR (browser=false)', async () => {
		const sw = fakeServiceWorker();
		const result = await runServiceWorkerLifecycle(baseEnv({ browser: false, serviceWorker: sw }));
		expect(result).toBe('skipped');
		expect(sw.register).not.toHaveBeenCalled();
	});

	it('skips when serviceWorker API is unsupported', async () => {
		const result = await runServiceWorkerLifecycle(baseEnv({ serviceWorker: undefined }));
		expect(result).toBe('skipped');
	});

	it('returns skipped (non-fatal) when register() throws', async () => {
		const sw = {
			register: vi.fn(async () => {
				throw new Error('boom');
			}),
			getRegistrations: vi.fn(async () => []),
		} as unknown as ServiceWorkerContainer;
		const result = await runServiceWorkerLifecycle(baseEnv({ serviceWorker: sw }));
		expect(result).toBe('skipped');
	});
});
