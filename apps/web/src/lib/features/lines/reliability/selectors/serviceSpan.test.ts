import { describe, it, expect } from 'vitest';
import { selectServiceSpan } from './serviceSpan';

const opts = {
	firstLabel: 'First trip',
	lastLabel: 'Last trip',
	firstDelayLabel: 'First-trip delay',
	lastDelayLabel: 'Last-trip delay',
	spanLabel: '18h 30m',
	tripsLabel: '142 trips',
	hourLabel: (h: number) => `${String(h).padStart(2, '0')}h`,
	ariaLabel: (a: string, b: string) => `Service from ${a} to ${b}`,
	absentTitle: 'Service span',
	noDataLabel: 'no data',
};

describe('selectServiceSpan', () => {
	it('builds a service-span spec on the fixed 24h domain with resolved endpoints', () => {
		const s = selectServiceSpan(
			{
				firstTripUtc: '2026-06-25T09:12:00Z', // 05:12 in America/Toronto (EDT, -4)
				lastTripUtc: '2026-06-26T03:38:00Z', // 23:38
				firstDelayMin: -1.5,
				lastDelayMin: 2,
			},
			'en',
			opts,
		);
		expect(s.kind).toBe('service-span');
		if (s.kind !== 'service-span') return;
		expect(s.domain).toEqual([0, 1440]);
		expect(s.firstMin).toBe(5 * 60 + 12);
		expect(s.lastMin).toBe(23 * 60 + 38);
		expect(s.firstDelayMin).toBe(-1.5);
		expect(s.spanLabel).toBe('18h 30m');
		expect(s.tripsLabel).toBe('142 trips');
		expect(s.hourTicks.map((t) => t.label)).toEqual(['00h', '06h', '12h', '18h', '24h']);
		expect(s.title).toContain('Service from');
	});

	it('renders an overnight service day on an extended service-day clock (FIX-2, no inverted bar)', () => {
		const s = selectServiceSpan(
			{
				firstTripUtc: '2026-06-25T09:00:00Z', // 05:00 Toronto (EDT)
				lastTripUtc: '2026-06-26T05:30:00Z', // 01:30 Toronto, NEXT calendar day
				firstDelayMin: 0.5,
				lastDelayMin: 4,
			},
			'en',
			opts,
		);
		expect(s.kind).toBe('service-span');
		if (s.kind !== 'service-span') return;
		expect(s.firstMin).toBe(5 * 60); // 300
		// The last trip's clock (01:30 = 90) falls BELOW the first → it is unwrapped forward one
		// day to 25:30 so the bar runs forward instead of inverting on a [0,1440] axis.
		expect(s.lastMin).toBe(25 * 60 + 30); // 1530
		expect(s.lastMin ?? 0).toBeGreaterThan(s.firstMin ?? 0);
		expect(s.domain).toEqual([0, 1800]); // extended 30h service-day clock
		expect(s.hourTicks.map((t) => t.label)).toEqual(['00h', '06h', '12h', '18h', '24h', '30h']);
	});

	it('returns an absence spec unless BOTH endpoints resolve (never a fabricated span)', () => {
		const onlyFirst = selectServiceSpan(
			{
				firstTripUtc: '2026-06-25T09:12:00Z',
				lastTripUtc: null,
				firstDelayMin: 0,
				lastDelayMin: null,
			},
			'en',
			opts,
		);
		expect(onlyFirst.kind).toBe('absence');

		const neither = selectServiceSpan(
			{ firstTripUtc: null, lastTripUtc: null, firstDelayMin: null, lastDelayMin: null },
			'en',
			opts,
		);
		expect(neither.kind).toBe('absence');
	});
});
