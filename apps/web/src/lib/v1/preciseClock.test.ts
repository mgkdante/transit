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

function serverClockFixture() {
	let real = 50_000;
	let elapsed = 0;
	let offset = 0;
	const ticking: TickingServerClock = {
		get now() {
			return real;
		},
		get serverNow() {
			return real + offset;
		},
		noteServerEpochMs: (value) => {
			offset = value - real;
		},
		subscribe: () => () => {},
	};
	const clock = preciseServerClock(
		ticking,
		() => real,
		() => elapsed,
	);
	return {
		clock,
		advance(ms: number) {
			real += ms;
			elapsed += ms;
		},
	};
}

describe('preciseServerClock', () => {
	it('keeps an unchanged report aging when a cached server Date is received again', () => {
		const { clock, advance } = serverClockFixture();
		clock.noteServerEpochMs(10_000);
		expect(clock.serverNow).toBe(10_000);
		const report = new Date(5_000).toISOString();
		for (let seconds = 1; seconds <= 5; seconds += 1) {
			advance(1000);
			clock.noteServerEpochMs(10_000);
			expect(freshnessAgeSeconds(report, clock.serverNow)).toBe(5 + seconds);
		}
		clock.noteServerEpochMs(16_000);
		expect(clock.serverNow).toBe(15_000);
		advance(1000);
		expect(clock.serverNow).toBe(16_000);
		expect(freshnessAgeSeconds(new Date(15_000).toISOString(), clock.serverNow)).toBe(1);
	});

	it('ignores ordinary response-time jitter instead of moving the global counter on clicks', () => {
		const { clock, advance } = serverClockFixture();
		clock.noteServerEpochMs(10_000);
		for (const [index, jitter] of [2000, -1000, 3000].entries()) {
			advance(1000);
			const expected = 11_000 + index * 1000;
			clock.noteServerEpochMs(expected + jitter);
			expect(clock.serverNow).toBe(expected);
		}
	});

	it('recovers an ahead-of-time calibration after consistent advancing server samples', () => {
		const { clock, advance } = serverClockFixture();
		clock.noteServerEpochMs(130_000);
		advance(1000);
		clock.noteServerEpochMs(101_000);
		expect(clock.serverNow).toBe(131_000);
		advance(1000);
		clock.noteServerEpochMs(102_000);
		expect(clock.serverNow).toBe(102_000);
	});

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
