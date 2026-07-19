// sharedClock — ONE app-wide "now" tick (Svelte 5 runes).
//
// Every relative-time readout in the chrome (TopBar refresh chip, the live
// freshness badge, the live clock) used to own its own `setInterval`. Those
// intervals drifted: each started on its own mount, so two "updated 12s ago"
// labels on the same page could advance a fraction of a second apart and read
// different values. This store collapses them into a SINGLE interval and a
// SINGLE `$state nowMs`, so every label reads the exact same clock and ticks in
// lockstep.
//
// Lifecycle (reference-counted, lazy):
//   - The interval is NOT running at module load. The first reader that calls
//     `subscribe()` starts it; the last reader to call the returned dispose
//     stops it. A component wires this with one `$effect(() => sharedClock.subscribe())`
//     — the effect's cleanup runs the dispose, so the timer lives exactly as
//     long as something is on screen reading it.
//   - `now` is also readable WITHOUT subscribing (a plain getter). Reading it
//     reactively in a `$derived`/template keeps you live to the tick, but only a
//     `subscribe()` keeps the interval ALIVE — a lone reader with no subscriber
//     sees a frozen snapshot (intended: nothing on screen needs it to move).
//
// Cadence honors `prefers-reduced-motion`: a per-second text update is motion.
// Under reduce we tick on a calmer cadence (still honest — freshness advances,
// just not animated character-by-character). The cadence is re-picked live when
// the OS preference flips while the clock is running.
//
// SSR-safe: `subscribe()` no-ops without a browser (returns a no-op dispose),
// so the timer only ever exists client-side. The initial `now` is a one-shot
// `Date.now()` snapshot, valid for the SSR frame.
//
// CLOCK SKEW (server-anchored age): `generated_utc` is stamped by the SERVER,
// but the per-second tick above runs off the CLIENT's `Date.now()`. On a client
// whose clock is skewed (e.g. 9 minutes fast) every "updated N ago" readout is
// wrong by the skew — fresh data reads "9 minutes ago", and freshness can
// falsely flip stale. The fix: `noteServerEpochMs()` records the offset between
// the server's clock (captured from the HTTP response `Date` header by the v1
// fetch primitive) and `Date.now()`, and `serverNow` exposes a tick that is the
// client tick PLUS that offset — i.e. an estimate of the SERVER's current time.
// Age computed against `serverNow` is skew-immune: both the build timestamp and
// the "now" it is subtracted from are on the server's clock. `now` (raw client)
// stays unchanged for any non-freshness caller; FRESHNESS reads `serverNow`.

import { browser } from '$app/environment';
import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';

/** Normal tick: per-second, so "12s ago" counts up smoothly. */
const TICK_MS = 1000;

/**
 * Reduced-motion tick: a calmer 30s cadence. Freshness still advances honestly
 * (and any age-based staleness flips within one window of the budget) without
 * animating a per-second counter for users who asked for less motion.
 */
const REDUCED_MOTION_TICK_MS = 30_000;

/** Shared "now" in epoch ms. Advanced by the single interval below. */
let nowMs = $state(Date.now());

/**
 * Client→server clock offset in ms: `serverEpochMs - Date.now()` at the moment
 * of the latest valid sample. Added to `nowMs` to estimate the server's current
 * time. Starts at 0 (no skew correction yet — `serverNow === now`), which is the
 * correct SSR/pre-fetch behavior (the server's own clock is accurate). The 30s
 * live poll feeds a fresh sample on every cycle, so the offset stays current.
 */
let offsetMs = $state(0);

/** Active reader count; the interval runs iff this is > 0. */
let subscribers = 0;
/** The single interval handle, or null when stopped. */
let timer: ReturnType<typeof setInterval> | null = null;
/** Cadence the running timer was started at, so we can detect a needed re-pick. */
let timerIntervalMs = 0;
/** Wired once: re-pick cadence when the OS reduced-motion preference flips. */
let motionListenerWired = false;
/** Wired once: pause the tick while the tab is hidden, resume + catch up on return. */
let visibilityListenerWired = false;

/** Tick cadence for the current motion preference. */
function currentIntervalMs(): number {
	return isPrefersReducedMotion() ? REDUCED_MOTION_TICK_MS : TICK_MS;
}

/** (Re)start the interval at the cadence for the current motion preference. */
function startTimer(): void {
	if (!browser) return;
	if (timer) clearInterval(timer);
	timerIntervalMs = currentIntervalMs();
	// Advance immediately so a cadence re-pick (e.g. reduced-motion just turned
	// off) refreshes the readout without waiting a full interval.
	nowMs = Date.now();
	timer = setInterval(() => {
		nowMs = Date.now();
	}, timerIntervalMs);
}

/** Stop the interval (last subscriber left). */
function stopTimer(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
	timerIntervalMs = 0;
}

/**
 * Wire a one-time OS-preference listener (browser-only) that re-picks the
 * cadence if reduced-motion flips WHILE the clock is running. The callback
 * fires outside any reactive read, so restarting the timer here is safe.
 */
function wireMotionListener(): void {
	if (motionListenerWired || typeof window === 'undefined') return;
	motionListenerWired = true;
	window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
		if (timer && currentIntervalMs() !== timerIntervalMs) startTimer();
	});
}

/**
 * Wire a one-time visibility listener (browser-only): PAUSE the interval while the
 * tab is hidden — a backgrounded tab has nothing on screen reading the tick, so
 * burning a per-second timer (and waking the CPU) is waste — and RESUME it the
 * instant the tab is visible again. startTimer() re-stamps `nowMs` immediately, so
 * a refocused tab jumps straight to the true age instead of showing a frozen
 * "12s ago" stuck at the moment it was hidden. The subscriber count is untouched,
 * so this only ever pauses/resumes a clock something is already reading.
 */
function wireVisibilityListener(): void {
	if (visibilityListenerWired || typeof document === 'undefined') return;
	visibilityListenerWired = true;
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			stopTimer();
		} else if (subscribers > 0 && !timer) {
			startTimer();
		}
	});
}

export const sharedClock = {
	/**
	 * Reactive shared "now" in epoch ms. Read inside a `$derived`/template to
	 * stay live with the tick; pair with `subscribe()` to keep the tick running.
	 */
	get now(): number {
		return nowMs;
	},

	/**
	 * SERVER-anchored "now" in epoch ms: the client tick PLUS the recorded
	 * client→server offset, so it ticks every interval AND reflects the skew
	 * correction. THIS is the freshness clock — age computed as
	 * `serverNow - generated_utc` is immune to a skewed client clock because both
	 * operands are on the server's timeline. Falls back to the raw client `now`
	 * (offset 0) on the server / before any sample, where the local clock is
	 * already trustworthy.
	 */
	get serverNow(): number {
		return nowMs + offsetMs;
	},

	/**
	 * Record a fresh server-time sample (epoch ms), recomputing the offset as
	 * `serverEpochMs - Date.now()`. Latest valid sample wins (the 30s live poll
	 * keeps it fresh). Browser-only and side-effect-guarded: no-ops without a
	 * browser (the offset stays 0 → `serverNow === now` on the server, whose
	 * clock is already accurate) and ignores a non-finite sample (a missing /
	 * unparseable `Date` header must never poison the offset).
	 */
	noteServerEpochMs(serverEpochMs: number): void {
		if (!browser || !Number.isFinite(serverEpochMs)) return;
		offsetMs = serverEpochMs - Date.now();
	},

	/**
	 * Register as a reader and ensure the single interval is running. Returns a
	 * dispose that decrements the reader count and stops the interval when the
	 * last reader leaves. SSR-safe: returns a no-op dispose without a browser.
	 *
	 * Idiomatic use in a component:
	 *   $effect(() => sharedClock.subscribe());
	 * The effect cleanup runs the dispose, so the timer is alive exactly while
	 * the component is mounted.
	 */
	subscribe(): () => void {
		if (!browser) return () => {};
		wireMotionListener();
		wireVisibilityListener();
		subscribers += 1;
		if (subscribers === 1) startTimer();
		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			subscribers = Math.max(0, subscribers - 1);
			if (subscribers === 0) stopTimer();
		};
	},
};
