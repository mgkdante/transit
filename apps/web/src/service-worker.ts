/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { files, version } from '$service-worker';
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

const OFFLINE_PATH = '/offline.html';

const MAP_POSTER_PATH_PREFIX = '/map/basemap-';
const NON_MAP_STATIC_FILES = files.filter(
	(file) => !new URL(file, ORIGIN).pathname.startsWith(MAP_POSTER_PATH_PREFIX),
);

const PRECACHE = precachePathnames(NON_MAP_STATIC_FILES, ORIGIN, OFFLINE_PATH);

const KILL_CHECK_THROTTLE_MS = 5 * 60 * 1000;
let lastKillCheck = 0;

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await Promise.all(
				[...PRECACHE].map(async (path) => {
					try {
						await cache.add(new Request(new URL(path, ORIGIN), { cache: 'reload' }));
					} catch {
						// Skip an asset that fails to load; never block install on it.
					}
				}),
			);
			await sw.skipWaiting();
		})(),
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			if (await checkKillAndMaybeTeardown()) return;

			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
			await sw.clients.claim();
		})(),
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	let url: URL;
	try {
		url = new URL(req.url);
	} catch {
		return;
	}

	if (!shouldIntercept(req, url, ORIGIN, PRECACHE)) return;

	if (isNavigationRequest(req)) {
		event.respondWith(handleNavigation(event));
		return;
	}

	if (isShellAsset(url, PRECACHE)) event.respondWith(cacheFirst(req));
});

sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string } | undefined;
	if (data?.type === 'CHECK_KILL') {
		event.waitUntil(checkKillAndMaybeTeardown());
	} else if (data?.type === 'SKIP_WAITING') {
		void sw.skipWaiting();
	}
});

async function handleNavigation(event: FetchEvent): Promise<Response> {
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

async function checkKillAndMaybeTeardown(): Promise<boolean> {
	const flag = await fetchKillFlag();
	if (!shouldKill(flag)) return false;

	const keys = await caches.keys();
	await Promise.all(keys.map((k) => caches.delete(k)));

	try {
		await sw.registration.unregister();
	} catch {
		// Unregister failure must not block client notification during cleanup.
	}

	try {
		await sw.clients.claim();
		const clients = await sw.clients.matchAll({ type: 'window' });
		for (const client of clients) {
			client.postMessage({ type: 'SW_KILLED' });
		}
	} catch {
		// Client notification is best effort after the caches have been removed.
	}
	return true;
}

async function fetchKillFlag(): Promise<KillFlag | null> {
	try {
		const res = await fetch(KILL_FLAG_PATH, { cache: 'no-store' });
		if (!res.ok) return null;
		return (await res.json()) as KillFlag;
	} catch {
		return null;
	}
}
