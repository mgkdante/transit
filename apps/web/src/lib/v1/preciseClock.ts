import type { ClockPort } from '#lib/v1/runtime.ts';

/** A tick-driven clock: `now` advances on each tick, `serverNow` adds the server offset to it. */
export interface TickingServerClock extends ClockPort {
	readonly now: number;
}

/**
 * Live ages compare publication times against the server clock with a 20 s tolerance for the
 * future. The shared clock only advances on its tick, which is 30 s under reduced motion, so its
 * `serverNow` can trail real time by more than that tolerance and fresh data reads as unknown age.
 * This port keeps the tick as the reactive trigger but reads the real time for the value.
 */
export function preciseServerClock(
	clock: TickingServerClock,
	realNow: () => number = Date.now,
): ClockPort {
	return {
		get serverNow() {
			const offsetMs = clock.serverNow - clock.now;
			return realNow() + offsetMs;
		},
		noteServerEpochMs: (serverEpochMs) => clock.noteServerEpochMs(serverEpochMs),
		subscribe: () => clock.subscribe(),
	};
}
