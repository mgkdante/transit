import { KILL_FLAG_PATH, shouldKill, type KillFlag } from './swPolicy';

const SERVICE_WORKER_URL = '/service-worker.js';

export interface RegisterEnv {
	browser: boolean;
	production: boolean;
	secureContext: boolean;
	serviceWorker?: ServiceWorkerContainer;
	caches?: CacheStorage;
	fetch: typeof fetch;
}

export async function fetchKillFlag(fetchImpl: typeof fetch): Promise<KillFlag | null> {
	try {
		const res = await fetchImpl(KILL_FLAG_PATH, { cache: 'no-store' });
		if (!res.ok) return null;
		return (await res.json()) as KillFlag;
	} catch {
		return null;
	}
}

export async function teardownServiceWorkers(env: RegisterEnv): Promise<void> {
	try {
		if (env.serviceWorker) {
			const regs = await env.serviceWorker.getRegistrations();
			await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
		}
	} catch {
		// Unavailable service-worker APIs must not block the remaining cache cleanup.
	}
	try {
		if (env.caches) {
			const keys = await env.caches.keys();
			await Promise.all(keys.map((k) => env.caches!.delete(k).catch(() => false)));
		}
	} catch {
		// Unavailable cache APIs must not block the page.
	}
}

export async function runServiceWorkerLifecycle(
	env: RegisterEnv,
): Promise<'skipped' | 'killed' | 'registered'> {
	if (!env.browser || !env.production || !env.secureContext || !env.serviceWorker) {
		if (env.browser && env.serviceWorker) {
			await teardownServiceWorkers(env);
		}
		return 'skipped';
	}

	const flag = await fetchKillFlag(env.fetch);
	if (shouldKill(flag)) {
		await teardownServiceWorkers(env);
		return 'killed';
	}

	try {
		await env.serviceWorker.register(SERVICE_WORKER_URL, { type: 'module' });
		return 'registered';
	} catch {
		return 'skipped';
	}
}

export function registerServiceWorker(opts: {
	browser: boolean;
	production: boolean;
}): Promise<'skipped' | 'killed' | 'registered'> {
	const nav = typeof navigator !== 'undefined' ? navigator : undefined;
	const env: RegisterEnv = {
		browser: opts.browser,
		production: opts.production,
		secureContext: typeof window !== 'undefined' ? window.isSecureContext === true : false,
		serviceWorker: nav && 'serviceWorker' in nav ? nav.serviceWorker : undefined,
		caches: typeof caches !== 'undefined' ? caches : undefined,
		fetch:
			typeof fetch !== 'undefined'
				? fetch.bind(globalThis)
				: ((() => Promise.reject()) as typeof fetch),
	};
	return runServiceWorkerLifecycle(env);
}
