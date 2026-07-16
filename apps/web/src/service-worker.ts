/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
//
// service-worker.ts — the Transit PWA service worker.
//
// This is a STICKY artifact on a LIVE portfolio site: once installed it persists
// in every visitor's browser until unregistered. It is therefore deliberately
// CONSERVATIVE and REMOTELY KILLABLE. All routing decisions live in the pure,
// unit-tested $lib/pwa/swPolicy module; this file only wires them to the real
// Cache / fetch / registration APIs.
//
// STRATEGY
//   navigations (HTML)        NETWORK-FIRST  — always fetch the live document;
//                             fall back to the cached offline page ONLY when the
//                             network throws (genuinely offline). Never serve a
//                             cached HTML document when online -> the kill-switch
//                             and any new deploy always take effect.
//   /data/* + /v1 snapshots   PASSTHROUGH    — never intercepted, never cached.
//   shell assets              CACHE-FIRST    — hashed /_app/immutable/* + the
//                             precached static set (fonts/icons/manifest/offline).
//   all other requests        PASSTHROUGH    — left to the browser default.
//
// KILL-SWITCH
//   On activate AND (throttled) on navigations, the SW fetches /sw-kill.json
//   (cache:'no-store'). If `{ "disabled": true }`, it deletes all caches,
//   unregisters itself, claims clients, and tells them to reload. The operator
//   kills a misbehaving SW by deploying static/sw-kill.json with disabled:true —
//   no code change required. A second, independent lever runs client-side from
//   the root layout (see $lib/pwa/register).

import { build, files, version } from '$service-worker';
import {
	KILL_FLAG_PATH,
	cacheNameFor,
	isNavigationRequest,
	isShellAsset,
	precachePathnames,
	shouldIntercept,
	shouldKill,
	type KillFlag,
} from '$lib/pwa/swPolicy';

const sw = self as unknown as ServiceWorkerGlobalScope;

const ORIGIN = sw.location.origin;
const CACHE = cacheNameFor(version);

/** Offline fallback document precached on install (see static/offline.html). */
const OFFLINE_PATH = '/offline.html';

/** Same-origin pathnames precached on install (hashed build + static + offline). */
const PRECACHE = precachePathnames([...build, ...files], ORIGIN, OFFLINE_PATH);

/** Min interval (ms) between kill-flag checks triggered from fetch handlers. */
const KILL_CHECK_THROTTLE_MS = 5 * 60 * 1000;
let lastKillCheck = 0;

// --- install: precache the shell + offline page ----------------------------

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			// Cache the hashed build + static set. addAll is atomic-ish; if any one
			// asset fails we still want the SW to install, so add individually and
			// swallow per-asset failures rather than aborting the whole install.
			await Promise.all(
				[...PRECACHE].map(async (path) => {
					try {
						await cache.add(new Request(path, { cache: 'reload' }));
					} catch {
						// Skip an asset that 404s / fails — never block install on it.
					}
				}),
			);
			// New SW takes over as soon as it finishes installing (paired with the
			// network-first shell, this is safe: the next navigation is always live).
			await sw.skipWaiting();
		})(),
	);
});

// --- activate: drop old caches, claim clients, honor the kill-flag ---------

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Remote kill check first — if disabled, tear everything down and bail.
			if (await checkKillAndMaybeTeardown()) return;

			// Delete every cache that isn't the current version.
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
			await sw.clients.claim();
		})(),
	);
});

// --- fetch: route per swPolicy ---------------------------------------------

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	let url: URL;
	try {
		url = new URL(req.url);
	} catch {
		return; // unparsable — let the browser handle it
	}

	// Only navigations and shell assets have a service-worker strategy. Data,
	// Range, cross-origin, non-GET, and arbitrary same-origin requests stay on
	// the browser's native network path.
	if (!shouldIntercept(req, url, ORIGIN, PRECACHE)) return;

	if (isNavigationRequest(req)) {
		event.respondWith(handleNavigation(event));
		return;
	}

	if (isShellAsset(url, PRECACHE)) event.respondWith(cacheFirst(req));
});

// --- message: allow clients to ping a kill check / skipWaiting -------------

sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string } | undefined;
	if (data?.type === 'CHECK_KILL') {
		event.waitUntil(checkKillAndMaybeTeardown());
	} else if (data?.type === 'SKIP_WAITING') {
		void sw.skipWaiting();
	}
});

// --- strategies ------------------------------------------------------------

/**
 * NETWORK-FIRST navigation. Always hit the network so the freshest shell (and
 * the kill-switch / new code) loads. On a genuine offline failure, fall back to
 * the precached offline page; if even that is missing, rethrow so the browser
 * shows its native error rather than a blank.
 */
async function handleNavigation(event: FetchEvent): Promise<Response> {
	// Throttled remote kill check piggybacked on navigations.
	const now = Date.now();
	if (now - lastKillCheck > KILL_CHECK_THROTTLE_MS) {
		lastKillCheck = now;
		event.waitUntil(checkKillAndMaybeTeardown());
	}

	try {
		return await fetch(event.request);
	} catch (err) {
		const cache = await caches.open(CACHE);
		const offline = await cache.match(OFFLINE_PATH);
		if (offline) return offline;
		throw err;
	}
}

/**
 * CACHE-FIRST for content-hashed / content-stable shell assets. Serve from cache
 * when present; otherwise fetch, cache a copy (only for same-origin OK basic
 * responses), and return it.
 */
async function cacheFirst(req: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const hit = await cache.match(req);
	if (hit) return hit;
	const res = await fetch(req);
	if (res.ok && res.type === 'basic') {
		cache.put(req, res.clone()).catch(() => {});
	}
	return res;
}

// --- kill-switch -----------------------------------------------------------

/**
 * Fetch the remote kill-flag (cache:'no-store'); if disabled, delete all caches,
 * unregister this SW, claim clients, and tell them to reload. Returns true when
 * the teardown ran (caller should stop normal activation work).
 */
async function checkKillAndMaybeTeardown(): Promise<boolean> {
	const flag = await fetchKillFlag();
	if (!shouldKill(flag)) return false;

	// Delete every cache for this origin.
	const keys = await caches.keys();
	await Promise.all(keys.map((k) => caches.delete(k)));

	// Unregister self so we never run again.
	try {
		await sw.registration.unregister();
	} catch {
		// ignore
	}

	// Take control + tell open tabs to reload into the (now SW-free) live site.
	try {
		await sw.clients.claim();
		const clients = await sw.clients.matchAll({ type: 'window' });
		for (const client of clients) {
			client.postMessage({ type: 'SW_KILLED' });
		}
	} catch {
		// ignore
	}
	return true;
}

/** Fetch + parse the kill-flag; null on any failure (fail-open / not killed). */
async function fetchKillFlag(): Promise<KillFlag | null> {
	try {
		const res = await fetch(KILL_FLAG_PATH, { cache: 'no-store' });
		if (!res.ok) return null;
		return (await res.json()) as KillFlag;
	} catch {
		return null;
	}
}
