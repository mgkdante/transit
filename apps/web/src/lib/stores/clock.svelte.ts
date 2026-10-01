import { browser } from '$app/environment';
import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
import { untrack } from 'svelte';

const TICK_MS = 1000;
const MAX_CLOCK_REWIND_MS = 2_000;

const REDUCED_MOTION_TICK_MS = 30_000;

let nowMs = $state(Date.now());

let offsetMs = $state(0);
let lastContinuousServerNowMs = Number.NEGATIVE_INFINITY;

let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let timerIntervalMs = 0;
let motionListenerWired = false;
let visibilityListenerWired = false;

function currentIntervalMs(): number {
	return isPrefersReducedMotion() ? REDUCED_MOTION_TICK_MS : TICK_MS;
}

function startTimer(): void {
	if (!browser) return;
	if (timer) clearInterval(timer);
	timerIntervalMs = currentIntervalMs();
	nowMs = Date.now();
	timer = setInterval(() => {
		nowMs = Date.now();
	}, timerIntervalMs);
}

function stopTimer(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
	timerIntervalMs = 0;
}

function wireMotionListener(): void {
	if (motionListenerWired || typeof window === 'undefined') return;
	motionListenerWired = true;
	window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
		if (timer && currentIntervalMs() !== timerIntervalMs) startTimer();
	});
}

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
	get now(): number {
		return nowMs;
	},

	get serverNow(): number {
		return nowMs + offsetMs;
	},

	serverNowContinuousMs(): number {
		const candidate = Date.now() + untrack(() => offsetMs);
		if (candidate >= lastContinuousServerNowMs) {
			lastContinuousServerNowMs = candidate;
			return candidate;
		}
		if (lastContinuousServerNowMs - candidate < MAX_CLOCK_REWIND_MS) {
			return lastContinuousServerNowMs;
		}
		lastContinuousServerNowMs = candidate;
		return candidate;
	},

	noteServerEpochMs(serverEpochMs: number): void {
		if (!browser || !Number.isFinite(serverEpochMs)) return;
		offsetMs = serverEpochMs - Date.now();
	},

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
