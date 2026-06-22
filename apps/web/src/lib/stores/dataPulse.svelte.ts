// dataPulse — the auto-refresh-on-new-publish engine.
//
// The app boots the manifest ONCE (+layout.ts) and never re-reads it: a snapshot
// published AFTER load is invisible until a manual refresh or a full navigation.
// This store closes that gap. It periodically RE-FETCHES the manifest fresh from
// the edge (getManifestFresh — bypasses the boot memo + the HTTP cache) and, on a
// strictly-newer `generated_utc` for ANY tier, bumps `dataRefresh.epoch`. That one
// bump already re-runs every createResource surface AND re-polls the live store
// (see refresh.svelte.ts), so the whole site swaps to the newest data with no
// per-surface wiring. The shared FreshnessStamp readouts then reflect the advance.
//
// MONOTONIC GUARD: we track the newest `generated_utc` we have ever SEEN across
// {live, static, historic} and only bump when a poll observes a strictly newer
// one. Equal or older manifests never bump (no thrash, no bump-on-republish-of-
// same-build, no bump when the edge briefly serves a stale copy). The first poll
// seeds the baseline WITHOUT bumping (the booted data is already the newest).
//
// CADENCE: the min tier ttl from the manifest (a static republish lands within a
// live window, so we never miss it for long), clamped to a sane floor so we don't
// hammer the edge. Falls back to a default when the manifest omits ttls.
//
// LIFECYCLE (reference-counted, browser-only, SSR-safe; mirrors sharedClock):
//   - subscribe() starts the poll on the first reader; the returned dispose stops
//     it when the last reader leaves. The root +layout subscribes it ONCE.
//   - VISIBILITY: the poll PAUSES while the tab is hidden (no point burning the
//     edge for a tab nobody is looking at) and does an immediate check on
//     re-focus, so returning to the tab shows the latest right away.
//   - SSR-safe: subscribe() no-ops without a browser (returns a no-op dispose).

import { browser } from '$app/environment';
import type { Manifest } from '$lib/v1/schemas';
import { dataRefresh } from './refresh.svelte';

// The manifest repository (→ $lib/v1/config → $env/dynamic/public) is imported
// LAZILY inside the poll, NOT at module load: this store is re-exported from the
// $lib/stores barrel that the whole app (and many component tests) pulls in for
// sharedClock, and a static import here would drag the env-reading config module
// into every one of those graphs. The dynamic import keeps the barrel light and
// runs only when polling actually starts (browser-only).
async function loadGetManifestFresh(): Promise<() => Promise<Manifest>> {
	const mod = await import('$lib/v1/repositories/manifest');
	return mod.getManifestFresh;
}

/** Cadence floor (ms): never poll the manifest more often than this. */
const MIN_INTERVAL_MS = 15_000;

/** Fallback cadence (ms) when the manifest carries no ttls. */
const DEFAULT_INTERVAL_MS = 30_000;

/** Active reader count; the poll runs iff this is > 0 AND the tab is visible. */
let subscribers = 0;
/** The single poll handle, or null when stopped. */
let timer: ReturnType<typeof setInterval> | null = null;
/** Wired-once visibilitychange listener guard. */
let visibilityWired = false;
/**
 * Newest `generated_utc` (epoch ms) ever observed across all tiers, or null
 * before the first poll. The monotonic baseline: a poll bumps only when it beats
 * this. Module-scoped so the baseline survives a stop/start (the data the app
 * already holds does not get "newer" just because polling paused).
 */
let lastSeenMs: number | null = null;

/** Parse a tier's generated_utc to epoch ms, or null when absent/invalid. */
function tierMs(generatedUtc: string | null | undefined): number | null {
	if (!generatedUtc) return null;
	const ms = Date.parse(generatedUtc);
	return Number.isNaN(ms) ? null : ms;
}

/** The newest generated_utc across {live, static, historic} (epoch ms), or null. */
function newestMs(manifest: Manifest): number | null {
	const files = manifest.files;
	const candidates = [
		tierMs(files.live?.generated_utc),
		tierMs(files.static?.generated_utc),
		tierMs(files.historic?.generated_utc),
	].filter((v): v is number => v != null);
	return candidates.length > 0 ? Math.max(...candidates) : null;
}

/** Poll cadence (ms): the min tier ttl, floored; default when none present. */
function intervalMsFor(manifest: Manifest): number {
	const files = manifest.files;
	const ttls = [files.live?.ttl_s, files.static?.ttl_s, files.historic?.ttl_s]
		.filter((v): v is number => typeof v === 'number' && v > 0)
		.map((s) => s * 1000);
	const base = ttls.length > 0 ? Math.min(...ttls) : DEFAULT_INTERVAL_MS;
	return Math.max(MIN_INTERVAL_MS, base);
}

/**
 * One poll: re-read the manifest fresh and bump the shared epoch on a strictly
 * newer publish. The FIRST poll seeds the baseline WITHOUT bumping (the booted
 * data is already current). Re-picks the cadence each poll so a ttl change in the
 * manifest is honored. Swallows transient fetch/parse errors — the next tick
 * retries; a blip must never tear the poll down.
 */
async function pollOnce(): Promise<void> {
	if (!browser) return;
	let manifest: Manifest;
	try {
		const getManifestFresh = await loadGetManifestFresh();
		manifest = await getManifestFresh();
	} catch {
		return;
	}
	// Re-pick cadence if the manifest's ttl changed (and the timer is running).
	const wanted = intervalMsFor(manifest);
	if (timer && wanted !== currentIntervalMs) restart(wanted);

	const observed = newestMs(manifest);
	if (observed == null) return;

	if (lastSeenMs == null) {
		// First observation: seed the baseline, do NOT bump (booted data is current).
		lastSeenMs = observed;
		return;
	}
	if (observed > lastSeenMs) {
		lastSeenMs = observed;
		// One bump re-runs every createResource surface AND re-polls the live store.
		dataRefresh.bumpEpoch();
	}
}

/** Cadence the running timer was started at (for re-pick detection). */
let currentIntervalMs = DEFAULT_INTERVAL_MS;

/** (Re)start the poll timer at `ms`. Does an immediate poll on (re)start. */
function restart(ms: number): void {
	if (!browser) return;
	if (timer) clearInterval(timer);
	currentIntervalMs = ms;
	timer = setInterval(() => void pollOnce(), ms);
}

/** Start polling: an immediate check, then on the cadence. Idempotent. */
function startTimer(): void {
	if (!browser || timer) return;
	// Poll once now to pick up anything published since boot; pollOnce seeds the
	// baseline on its first run, so this initial poll never bumps.
	void pollOnce();
	restart(currentIntervalMs);
}

/** Stop the poll timer (tab hidden, or last reader left). */
function stopTimer(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}

/** Wire a one-time visibilitychange listener: pause when hidden, resume on show. */
function wireVisibility(): void {
	if (visibilityWired || typeof document === 'undefined') return;
	visibilityWired = true;
	document.addEventListener('visibilitychange', () => {
		if (subscribers === 0) return;
		if (document.visibilityState === 'hidden') {
			stopTimer();
		} else {
			// Re-focus: resume polling AND check immediately so the tab shows the
			// latest right away (startTimer's initial pollOnce handles the check).
			startTimer();
		}
	});
}

export const dataPulse = {
	/**
	 * The newest `generated_utc` (epoch ms) observed so far, or null before the
	 * first poll. Exposed for tests / diagnostics; not a reactive readout.
	 */
	get lastSeenMs(): number | null {
		return lastSeenMs;
	},

	/**
	 * Register as a reader and ensure the poll is running (tab-visibility aware).
	 * Returns a dispose that decrements the reader count and stops the poll when
	 * the last reader leaves. SSR-safe: returns a no-op dispose without a browser.
	 *
	 * Subscribe ONCE from the root +layout:
	 *   $effect(() => dataPulse.subscribe());
	 */
	subscribe(): () => void {
		if (!browser) return () => {};
		wireVisibility();
		subscribers += 1;
		if (subscribers === 1 && document.visibilityState !== 'hidden') startTimer();
		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			subscribers = Math.max(0, subscribers - 1);
			if (subscribers === 0) stopTimer();
		};
	},

	/**
	 * TEST-ONLY: reset the module baseline + tear down the timer so each test
	 * starts from a clean slate (the baseline is module-scoped by design).
	 */
	_resetForTests(): void {
		stopTimer();
		subscribers = 0;
		lastSeenMs = null;
		currentIntervalMs = DEFAULT_INTERVAL_MS;
	},
};
