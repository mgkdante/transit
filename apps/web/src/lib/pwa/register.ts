// register — CLIENT-SIDE service-worker lifecycle + kill-switch enforcement.
//
// This runs from the root layout on EVERY load. Because navigations are
// network-first (the SW never serves a stale HTML shell when online), this code
// always re-runs with the latest deploy — so it is the second, independent lever
// of the remote kill-switch:
//
//   1. Fetch the kill-flag (cache:'no-store').
//   2. If disabled -> tear down: unregister ALL service workers + delete ALL
//      caches, and DO NOT register. An already-installed (misbehaving) SW is
//      removed on the visitor's next visit, with zero new SW code shipped.
//   3. Otherwise, register the SW (browser + secure-context + production only).
//
// The decision logic (shouldKill / KILL_FLAG_PATH) is shared with the SW via
// swPolicy.ts, so both levers agree on what "killed" means.

import { KILL_FLAG_PATH, shouldKill, type KillFlag } from './swPolicy';

/** The same-origin URL of the registered SW script (SvelteKit's default name). */
const SERVICE_WORKER_URL = '/service-worker.js';

/**
 * Environment capabilities the registration step needs. Injected so the helper
 * is unit-testable without a real browser. In production these are read from the
 * live globals by `registerServiceWorker`.
 */
export interface RegisterEnv {
	/** Are we in the browser (vs SSR)? */
	browser: boolean;
	/** Is this a production build? (Dev never registers a sticky SW.) */
	production: boolean;
	/** Is the page a secure context (https or localhost)? SW requires it. */
	secureContext: boolean;
	/** navigator.serviceWorker, when present. */
	serviceWorker?: ServiceWorkerContainer;
	/** The CacheStorage API, when present. */
	caches?: CacheStorage;
	/** A fetch implementation (defaults to global fetch). */
	fetch: typeof fetch;
}

/**
 * Fetch the remote kill-flag with cache:'no-store'. Returns null on any failure
 * (network down, non-OK, malformed JSON) — callers treat null as "not killed"
 * (fail-open), so a momentarily-unreachable flag never tears down the SW.
 */
export async function fetchKillFlag(fetchImpl: typeof fetch): Promise<KillFlag | null> {
	try {
		const res = await fetchImpl(KILL_FLAG_PATH, { cache: 'no-store' });
		if (!res.ok) return null;
		return (await res.json()) as KillFlag;
	} catch {
		return null;
	}
}

/**
 * Unregister EVERY service worker and delete EVERY cache for this origin. Used
 * by the kill-switch teardown path. Best-effort: never throws.
 */
export async function teardownServiceWorkers(env: RegisterEnv): Promise<void> {
	try {
		if (env.serviceWorker) {
			const regs = await env.serviceWorker.getRegistrations();
			await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
		}
	} catch {
		// ignore — best effort
	}
	try {
		if (env.caches) {
			const keys = await env.caches.keys();
			await Promise.all(keys.map((k) => env.caches!.delete(k).catch(() => false)));
		}
	} catch {
		// ignore — best effort
	}
}

/**
 * The full client-side lifecycle decision + action. Returns what it did so the
 * caller (and tests) can assert: 'skipped' (not eligible), 'killed' (torn down,
 * not registered), or 'registered'.
 */
export async function runServiceWorkerLifecycle(
	env: RegisterEnv,
): Promise<'skipped' | 'killed' | 'registered'> {
	// Eligibility gate: browser + production + secure context + SW support.
	if (!env.browser || !env.production || !env.secureContext || !env.serviceWorker) {
		// In dev (or an unsupported context) make sure no STALE sticky SW from a
		// prior prod visit lingers on this origin — tear any down, but do not register.
		if (env.browser && env.serviceWorker) {
			await teardownServiceWorkers(env);
		}
		return 'skipped';
	}

	// Belt-and-suspenders kill-switch: honor the remote flag BEFORE registering.
	const flag = await fetchKillFlag(env.fetch);
	if (shouldKill(flag)) {
		await teardownServiceWorkers(env);
		return 'killed';
	}

	try {
		await env.serviceWorker.register(SERVICE_WORKER_URL, { type: 'module' });
		return 'registered';
	} catch {
		// Registration failure is non-fatal — the app works without the SW.
		return 'skipped';
	}
}

/**
 * Production entry point. Reads the live browser globals and runs the lifecycle.
 * Call once from the root layout's onMount. Safe to call during SSR (no-ops).
 *
 * @param opts.browser    SvelteKit's `browser` flag.
 * @param opts.production whether this is a production build (import.meta.env.PROD).
 */
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
