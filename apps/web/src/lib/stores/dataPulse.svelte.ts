import { browser } from '$app/environment';
import type { Manifest } from '$lib/v1/schemas';
import { dataRefresh } from './refresh.svelte';

async function loadGetManifestFresh(): Promise<() => Promise<Manifest>> {
	const mod = await import('$lib/v1/repositories/manifest');
	return mod.getManifestFresh;
}

const MIN_INTERVAL_MS = 5 * 60 * 1000;

const DEFAULT_INTERVAL_MS = MIN_INTERVAL_MS;

let subscribers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let lifecycleWired = false;
let inFlight: Promise<void> | null = null;
let inFlightGeneration: number | null = null;
let queuedGeneration: number | null = null;
let lifecycleGeneration = 0;
let lastCheckAtMs: number | null = null;
let lastSeenMs: number | null = null;
let seeded = false;
let lastSeenByTier: Record<'static' | 'historic', number | null> = {
	static: null,
	historic: null,
};

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

function intervalMsFor(manifest: Manifest): number {
	const files = manifest.files;
	const ttls = [files.static?.ttl_s, files.historic?.ttl_s]
		.filter((v): v is number => typeof v === 'number' && v > 0)
		.map((s) => s * 1000);
	const base = ttls.length > 0 ? Math.min(...ttls) : DEFAULT_INTERVAL_MS;
	return Math.max(MIN_INTERVAL_MS, base);
}

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
	if (generation !== lifecycleGeneration || !shouldRun()) return;
	const wanted = intervalMsFor(manifest);
	if (wanted !== currentIntervalMs) {
		currentIntervalMs = wanted;
	}

	if (observeRefreshTiers(manifest)) {
		dataRefresh.bumpEpoch();
	}
}

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

function requestPoll(): Promise<void> {
	const generation = lifecycleGeneration;
	if (inFlight) {
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

function scheduleNextPoll(delayMs = remainingDelayMs()): void {
	if (!browser || !shouldRun() || timer) return;
	timer = setTimeout(() => {
		timer = null;
		void requestPoll();
	}, delayMs);
}

function startTimer(): void {
	if (!browser || !shouldRun()) return;
	if (timer) return;
	scheduleNextPoll();
}

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
	get lastSeenMs(): number | null {
		return lastSeenMs;
	},

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
