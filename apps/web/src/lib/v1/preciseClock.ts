import type { ClockPort } from '#lib/v1/runtime.ts';

/** A tick-driven clock: `now` advances on each tick, `serverNow` adds the server offset to it. */
export interface TickingServerClock extends ClockPort {
	readonly now: number;
}

type ClockSample = { epochMs: number; receivedAt: number };
const HTTP_DATE_PRECISION_MS = 1000;

/**
 * Live ages compare publication times against the server clock with a 20 s tolerance for the
 * future. The shared clock only advances on its tick, which is 30 s under reduced motion, so its
 * `serverNow` can trail real time by more than that tolerance and fresh data reads as unknown age.
 * This port keeps the tick as the reactive trigger but reads the real time for the value.
 */
export function preciseServerClock(
	clock: TickingServerClock,
	realNow: () => number = Date.now,
	monotonicNow: () => number = () => performance.now(),
): ClockPort {
	let sample: ClockSample | null = null;
	let correction: ClockSample | null = null;
	return {
		get serverNow() {
			const offsetMs = clock.serverNow - clock.now;
			return realNow() + offsetMs;
		},
		noteServerEpochMs(serverEpochMs) {
			if (!Number.isFinite(serverEpochMs)) return;
			const receivedAt = monotonicNow();
			// Cached Date headers and second-resolution samples must not make the same report younger.
			const projected = sample
				? sample.epochMs + Math.max(0, receivedAt - sample.receivedAt)
				: serverEpochMs;
			const needsCorrection = projected - serverEpochMs > 2 * HTTP_DATE_PRECISION_MS;
			// Two distinct samples advancing with elapsed time can correct a bad initial clock.
			// Replaying the same cached header cannot confirm that correction.
			const confirmed =
				correction !== null &&
				serverEpochMs > correction.epochMs &&
				Math.abs(serverEpochMs - correction.epochMs - (receivedAt - correction.receivedAt)) <=
					HTTP_DATE_PRECISION_MS;
			const epochMs =
				needsCorrection && confirmed ? serverEpochMs : Math.max(serverEpochMs, projected);
			if (!needsCorrection || confirmed) correction = null;
			else if (correction?.epochMs !== serverEpochMs)
				correction = { epochMs: serverEpochMs, receivedAt };
			sample = { epochMs, receivedAt };
			clock.noteServerEpochMs(epochMs);
		},
		subscribe: () => clock.subscribe(),
	};
}
