import { describe, expect, it, vi } from 'vitest';
import { preciseServerClock, type TickingServerClock } from '#lib/v1/preciseClock.ts';
import { freshnessAgeSeconds } from '#lib/v1/freshness.ts';

function tickingClock(tickMs: number, offsetMs: number): TickingServerClock {
	return {
		now: tickMs,
		serverNow: tickMs + offsetMs,
		noteServerEpochMs: vi.fn(),
		subscribe: vi.fn(() => () => {}),
	};
}

describe('preciseServerClock', () => {
	it('uses the real time when the tick lags behind, keeping the server offset', () => {
		const real = Date.parse('2026-11-10T19:01:30Z');
		// Reduced motion ticks every 30 s; the last tick was 29 s ago and the server is 2 s ahead.
		const clock = preciseServerClock(tickingClock(real - 29_000, 2_000), () => real);
		expect(clock.serverNow).toBe(real + 2_000);
	});

	it('gives fresh data a known age where the lagging tick would call it unknown', () => {
		const real = Date.parse('2026-11-10T19:01:30Z');
		const ticking = tickingClock(real - 29_000, 0);
		const generated = new Date(real - 3_000).toISOString();
		expect(freshnessAgeSeconds(generated, ticking.serverNow, 20)).toBeNull();
		expect(
			freshnessAgeSeconds(generated, preciseServerClock(ticking, () => real).serverNow, 20),
		).toBe(3);
	});

	it('forwards server time notes and subscriptions to the shared clock', () => {
		const ticking = tickingClock(0, 0);
		const clock = preciseServerClock(ticking, () => 0);
		clock.noteServerEpochMs(123);
		clock.subscribe();
		expect(ticking.noteServerEpochMs).toHaveBeenCalledWith(123);
		expect(ticking.subscribe).toHaveBeenCalledOnce();
	});
});
