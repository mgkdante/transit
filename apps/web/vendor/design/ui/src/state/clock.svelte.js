import { untrack } from 'svelte';
import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';

const TICK_MS = 1000;
const REDUCED_MOTION_TICK_MS = 30_000;
const MAX_CLOCK_REWIND_MS = 2_000;

let nowMs = $state(Date.now());
let offsetMs = $state(0);
let lastContinuousServerNowMs = Number.NEGATIVE_INFINITY;

let subscribers = 0;
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
let timerIntervalMs = 0;
let listenersWired = false;

const currentIntervalMs = () => (isPrefersReducedMotion() ? REDUCED_MOTION_TICK_MS : TICK_MS);

function startTimer() {
	if (timer) clearInterval(timer);
	timerIntervalMs = currentIntervalMs();
	nowMs = Date.now();
	timer = setInterval(() => {
		nowMs = Date.now();
	}, timerIntervalMs);
}

function stopTimer() {
	if (timer) clearInterval(timer);
	timer = null;
	timerIntervalMs = 0;
}

function wireListeners() {
	if (listenersWired) return;
	listenersWired = true;
	window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
		if (timer && currentIntervalMs() !== timerIntervalMs) startTimer();
	});
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) stopTimer();
		else if (subscribers > 0 && !timer) startTimer();
	});
}

export const clock = {
	get now() {
		return nowMs;
	},
	get serverNow() {
		return nowMs + offsetMs;
	},
	serverNowContinuousMs() {
		const candidate = Date.now() + untrack(() => offsetMs);
		if (candidate >= lastContinuousServerNowMs || lastContinuousServerNowMs - candidate >= MAX_CLOCK_REWIND_MS) {
			lastContinuousServerNowMs = candidate;
		}
		return lastContinuousServerNowMs;
	},
	/** @param {number} serverEpochMs */
	noteServerEpochMs(serverEpochMs) {
		if (typeof window === 'undefined' || !Number.isFinite(serverEpochMs)) return;
		offsetMs = serverEpochMs - Date.now();
	},
	subscribe() {
		if (typeof window === 'undefined') return () => {};
		wireListeners();
		subscribers += 1;
		if (subscribers === 1) startTimer();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			subscribers = Math.max(0, subscribers - 1);
			if (subscribers === 0) stopTimer();
		};
	},
};
