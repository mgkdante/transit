import type { ClockPort } from '#lib/v1/runtime.ts';
import { createSubscriber } from 'svelte/reactivity';

/** A tick-driven clock: `now` advances on each tick, `serverNow` adds the server offset to it. */
export interface TickingServerClock extends ClockPort {
	readonly now: number;
}

type ClockSample = { epochMs: number; receivedAt: number };
const HTTP_DATE_PRECISION_MS = 1000;
const DRIFT_TOLERANCE_MS = 5000;

function confirmsDrift(previous: ClockSample | null, epochMs: number, receivedAt: number): boolean {
	return (
		previous !== null &&
		epochMs > previous.epochMs &&
		Math.abs(epochMs - previous.epochMs - (receivedAt - previous.receivedAt)) <=
			HTTP_DATE_PRECISION_MS
	);
}

/**
 * Live ages compare publication times against the server clock with a 20 s tolerance for the
 * future. The shared clock only advances on its tick, which is 30 s under reduced motion, so its
 * `serverNow` can trail real time by more than that tolerance and fresh data reads as unknown age.
 * Data ages use one shared second tick independently of decorative motion preferences.
 * After initial synchronization, elapsed monotonic time drives the counter; normal HTTP jitter
 * cannot retime it. A response Date can lag the true time, because a cache replays it unchanged,
 * but it can never lead it. So a reading well ahead of the counter is believed at once, and a
 * reading well behind it only when a second, consistently advancing one confirms it.
 */
export function preciseServerClock(
	clock: TickingServerClock,
	realNow: () => number = Date.now,
	monotonicNow: () => number = () => performance.now(),
): ClockPort {
	let sample: ClockSample | null = null;
	let correction: ClockSample | null = null;
	const trackTick = createSubscriber((update) => {
		const timer = setInterval(update, 1000);
		return () => clearInterval(timer);
	});
	return {
		get serverNow() {
			trackTick();
			return sample
				? sample.epochMs + Math.max(0, monotonicNow() - sample.receivedAt)
				: realNow() + (clock.serverNow - clock.now);
		},
		noteServerEpochMs(serverEpochMs) {
			if (!Number.isFinite(serverEpochMs)) return;
			const receivedAt = monotonicNow();
			const projected = sample
				? sample.epochMs + Math.max(0, receivedAt - sample.receivedAt)
				: serverEpochMs;
			if (sample && Math.abs(projected - serverEpochMs) <= DRIFT_TOLERANCE_MS) {
				correction = null;
				return;
			}
			const behind = sample !== null && serverEpochMs < projected;
			if (behind && !confirmsDrift(correction, serverEpochMs, receivedAt)) {
				if (correction?.epochMs !== serverEpochMs)
					correction = { epochMs: serverEpochMs, receivedAt };
				return;
			}
			correction = null;
			sample = { epochMs: serverEpochMs, receivedAt };
			clock.noteServerEpochMs(serverEpochMs);
		},
		subscribe: () => clock.subscribe(),
	};
}
