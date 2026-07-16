// dataPulse — the auto-refresh-on-new-publish engine.
//
// The app boots the manifest ONCE (+layout.ts) and never re-reads it: a snapshot
// published AFTER load is invisible until a manual refresh or a full navigation.
// This store closes that gap. It periodically re-reads the manifest from its
// stable edge URL (getManifestFresh bypasses only the boot memo) and, on a
// strictly-newer static or historic `generated_utc`, bumps `dataRefresh.epoch`.
// The live tier is intentionally excluded: createLiveStore already owns its 30s
// cadence, and bumping the global epoch for the same live publish would launch a
// redundant live batch plus reload every static/historic surface.
//
// MONOTONIC GUARD: static and historic baselines are tracked independently, then
// aggregated into at most one epoch bump per manifest. Equal or older manifests
// never bump. The authoritative boot manifest seeds both baselines before the
// first scheduled poll; callers without a boot manifest retain the fail-safe
// behavior where an immediate first successful poll seeds without bumping.
//
// CADENCE: the min static/historic ttl from the manifest, clamped to a five-minute
// discovery floor. Live is excluded because this store does not observe live
// publishes. Resume checks preserve the remaining cadence instead of multiplying
// requests during rapid focus/network transitions.
//
// LIFECYCLE (reference-counted, browser-only, SSR-safe; mirrors sharedClock):
//   - subscribe() starts the poll on the first reader; the returned dispose stops
//     it when the last reader leaves. The root +layout subscribes it ONCE.
//   - VISIBILITY: the poll PAUSES while the tab is hidden (no point burning the
//     edge for a tab nobody is looking at) and resumes with the remaining delay,
//     checking immediately only when the cadence is already due.
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

/** Cadence floor (ms): never poll the manifest more often than every five minutes. */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

/** Fallback cadence (ms) when the manifest carries no observed-tier ttls. */
const DEFAULT_INTERVAL_MS = MIN_INTERVAL_MS;

/** Active reader count; the poll runs iff this is > 0, visible, and online. */
let subscribers = 0;
/** The single poll handle, or null when stopped. */
let timer: ReturnType<typeof setTimeout> | null = null;
/** Lifecycle-listener guard; listeners exist only while at least one reader does. */
let lifecycleWired = false;
/** Shared in-flight poll across interval, visibility, and online triggers. */
let inFlight: Promise<void> | null = null;
let inFlightGeneration: number | null = null;
/** Latest resumed generation waiting for an older in-flight request to settle. */
let queuedGeneration: number | null = null;
/** Invalidates work that began before a hidden/offline/disposed transition. */
let lifecycleGeneration = 0;
/** Most recent manifest check start, including an authoritative boot manifest. */
let lastCheckAtMs: number | null = null;
/**
 * Newest static/historic `generated_utc` (epoch ms) observed so far, or null
 * before either tier is present. Module-scoped so the baseline survives a
 * stop/start; data does not get newer just because polling paused.
 */
let lastSeenMs: number | null = null;
let seeded = false;
let lastSeenByTier: Record<'static' | 'historic', number | null> = {
	static: null,
	historic: null,
};

/** Parse a tier's generated_utc to epoch ms, or null when absent/invalid. */
function tierMs(generatedUtc: string | null | undefined): number | null {
	if (!generatedUtc) return null;
	const ms = Date.parse(generatedUtc);
	return Number.isNaN(ms) ? null : ms;
}

function observedRefreshTiers(manifest: Manifest): Record<'static' | 'historic', number | null> {
	return {
		static: tierMs(manifest.files.static?.generated_utc),
		historic: tierMs(manifest.files.historic?.generated_utc),
	};
}

function updateLastSeenMs(): void {
	const newest = Object.values(lastSeenByTier).filter((value): value is number => value != null);
	lastSeenMs = newest.length > 0 ? Math.max(...newest) : null;
}

/**
 * Seed from data the app already booted. A later boot can only move a tier's
 * baseline forward; it can never make the monotonic guard forget a newer poll.
 */
function seedFromBootManifest(manifest: Manifest): void {
	const observed = observedRefreshTiers(manifest);
	if (!seeded) {
		seeded = true;
		lastSeenByTier = observed;
		updateLastSeenMs();
		return;
	}
	for (const tier of ['static', 'historic'] as const) {
		const next = observed[tier];
		if (next != null && (lastSeenByTier[tier] == null || next > lastSeenByTier[tier])) {
			lastSeenByTier[tier] = next;
		}
	}
	updateLastSeenMs();
}

/**
 * Observe static/historic publish clocks and report whether either advanced.
 * Live is deliberately ignored because its dedicated store already polls it.
 */
function observeRefreshTiers(manifest: Manifest): boolean {
	const observed = observedRefreshTiers(manifest);

	if (!seeded) {
		seedFromBootManifest(manifest);
		return false;
	}

	let advanced = false;
	for (const tier of ['static', 'historic'] as const) {
		const next = observed[tier];
		if (next != null && (lastSeenByTier[tier] == null || next > lastSeenByTier[tier])) {
			lastSeenByTier[tier] = next;
			advanced = true;
		}
	}
	updateLastSeenMs();
	return advanced;
}

/** Poll cadence (ms): the min observed-tier ttl, floored; default when absent. */
function intervalMsFor(manifest: Manifest): number {
	const files = manifest.files;
	const ttls = [files.static?.ttl_s, files.historic?.ttl_s]
		.filter((v): v is number => typeof v === 'number' && v > 0)
		.map((s) => s * 1000);
	const base = ttls.length > 0 ? Math.min(...ttls) : DEFAULT_INTERVAL_MS;
	return Math.max(MIN_INTERVAL_MS, base);
}

/**
 * One poll: re-read the manifest and bump the shared epoch on a strictly
 * newer publish. The FIRST poll seeds the baseline WITHOUT bumping (the booted
 * data is already current). Re-picks the cadence each poll so a ttl change in the
 * manifest is honored. Swallows transient fetch/parse errors — the next tick
 * retries; a blip must never tear the poll down.
 */
async function pollOnce(generation: number): Promise<void> {
	if (!browser || generation !== lifecycleGeneration || !shouldRun()) return;
	let manifest: Manifest;
	try {
		const getManifestFresh = await loadGetManifestFresh();
		if (generation !== lifecycleGeneration || !shouldRun()) return;
		manifest = await getManifestFresh();
	} catch {
		return;
	}
	// The request may have outlived a hide, offline transition, or final dispose.
	// Even if the page resumed before it resolved, that older generation must not
	// alter cadence/baselines or bump the shared refresh epoch.
	if (generation !== lifecycleGeneration || !shouldRun()) return;
	// Re-pick cadence if the observed tiers changed their ttl.
	const wanted = intervalMsFor(manifest);
	if (wanted !== currentIntervalMs) {
		currentIntervalMs = wanted;
	}

	if (observeRefreshTiers(manifest)) {
		// One bump re-runs every createResource surface AND re-polls the live store.
		dataRefresh.bumpEpoch();
	}
}

/** Active discovery cadence, updated from every successful manifest read. */
let currentIntervalMs = DEFAULT_INTERVAL_MS;

function isVisible(): boolean {
	return typeof document !== 'undefined' && document.visibilityState !== 'hidden';
}

function isOnline(): boolean {
	return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function shouldRun(): boolean {
	return subscribers > 0 && isVisible() && isOnline();
}

/** Share one manifest request across every trigger until it settles. */
function requestPoll(): Promise<void> {
	const generation = lifecycleGeneration;
	if (inFlight) {
		// A due check after invalidation waits for the stale request to settle, then
		// checks again. This preserves one request at a time without losing the check.
		if (inFlightGeneration !== generation) queuedGeneration = generation;
		return inFlight;
	}
	lastCheckAtMs = Date.now();
	const pending = pollOnce(generation);
	const tracked = pending.finally(() => {
		if (inFlight !== tracked) return;
		inFlight = null;
		inFlightGeneration = null;
		const queued = queuedGeneration;
		queuedGeneration = null;
		if (queued === lifecycleGeneration && shouldRun()) {
			void requestPoll();
			return;
		}
		if (shouldRun() && !timer) scheduleNextPoll();
	});
	inFlight = tracked;
	inFlightGeneration = generation;
	return tracked;
}

function remainingDelayMs(): number {
	if (lastCheckAtMs === null) return 0;
	return Math.max(0, currentIntervalMs - Math.max(0, Date.now() - lastCheckAtMs));
}

/** Schedule one due check; a completed request schedules the next one. */
function scheduleNextPoll(delayMs = remainingDelayMs()): void {
	if (!browser || !shouldRun() || timer) return;
	timer = setTimeout(() => {
		timer = null;
		void requestPoll();
	}, delayMs);
}

/** Start or resume the cadence from the last authoritative check. */
function startTimer(): void {
	if (!browser || !shouldRun()) return;
	if (timer) return;
	scheduleNextPoll();
}

/** Stop the poll timer (tab hidden, or last reader left). */
function stopTimer(): void {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
}

function invalidateLifecycle(): void {
	lifecycleGeneration += 1;
	queuedGeneration = null;
}

function handleLifecycleChange(): void {
	if (shouldRun()) startTimer();
	else {
		invalidateLifecycle();
		stopTimer();
	}
}

/** Wire visibility + network lifecycle only while the engine has readers. */
function wireLifecycle(): void {
	if (lifecycleWired || typeof document === 'undefined' || typeof window === 'undefined') return;
	lifecycleWired = true;
	document.addEventListener('visibilitychange', handleLifecycleChange);
	window.addEventListener('online', handleLifecycleChange);
	window.addEventListener('offline', handleLifecycleChange);
}

function unwireLifecycle(): void {
	if (!lifecycleWired || typeof document === 'undefined' || typeof window === 'undefined') return;
	document.removeEventListener('visibilitychange', handleLifecycleChange);
	window.removeEventListener('online', handleLifecycleChange);
	window.removeEventListener('offline', handleLifecycleChange);
	lifecycleWired = false;
}

export const dataPulse = {
	/**
	 * The newest static/historic `generated_utc` (epoch ms) observed so far, or
	 * null before either tier is seen. Exposed for tests / diagnostics only.
	 */
	get lastSeenMs(): number | null {
		return lastSeenMs;
	},

	/**
	 * Register as a reader and ensure the poll is running (tab-visibility aware).
	 * Returns a dispose that decrements the reader count and stops the poll when
	 * the last reader leaves. SSR-safe: returns a no-op dispose without a browser.
	 * An explicit `null` means the root manifest is still pending, so no discovery
	 * lane is opened beside that boot request. Omitting the argument preserves the
	 * standalone fail-safe that starts with one immediate baseline poll.
	 *
	 * Subscribe ONCE from the root +layout:
	 *   $effect(() => dataPulse.subscribe());
	 */
	subscribe(bootManifest?: Manifest | null): () => void {
		if (!browser || bootManifest === null) return () => {};
		if (bootManifest) {
			seedFromBootManifest(bootManifest);
			currentIntervalMs = intervalMsFor(bootManifest);
			if (subscribers === 0) lastCheckAtMs = Date.now();
		}
		wireLifecycle();
		subscribers += 1;
		if (subscribers === 1) startTimer();
		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			subscribers = Math.max(0, subscribers - 1);
			if (subscribers === 0) {
				invalidateLifecycle();
				stopTimer();
				unwireLifecycle();
			}
		};
	},

	/**
	 * TEST-ONLY: reset the module baseline + tear down the timer so each test
	 * starts from a clean slate (the baseline is module-scoped by design).
	 */
	_resetForTests(): void {
		invalidateLifecycle();
		stopTimer();
		unwireLifecycle();
		subscribers = 0;
		inFlight = null;
		inFlightGeneration = null;
		lastSeenMs = null;
		seeded = false;
		lastSeenByTier = { static: null, historic: null };
		currentIntervalMs = DEFAULT_INTERVAL_MS;
		lastCheckAtMs = null;
	},
};
