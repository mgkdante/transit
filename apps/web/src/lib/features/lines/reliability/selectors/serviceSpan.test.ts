import { describe, it, expect } from 'vitest';
import { selectServiceSpan } from './serviceSpan';

const opts = {
	firstLabel: 'First observed trip',
	lastLabel: 'Last observed trip',
	firstDelayLabel: 'First-trip delay',
	lastDelayLabel: 'Last-trip delay',
	spanLabel: null,
	tripsLabel: null,
	hourLabel: (hour: number) => `+${hour}h`,
	ariaLabel: (first: string, last: string) => `Observed span from ${first} to ${last}`,
	absentTitle: 'Observed service span',
	noDataLabel: 'no data',
};
const input = (firstTripUtc: string | null, lastTripUtc: string | null) => ({
	firstTripUtc,
	lastTripUtc,
	firstDelayMin: -1.5,
	lastDelayMin: 2,
});

describe('selectServiceSpan', () => {
	it('uses elapsed geometry and preserves consistent published annotations', () => {
		const span = selectServiceSpan(input('2026-06-25T09:12:00Z', '2026-06-26T03:38:00Z'), 'en', {
			...opts,
			spanLabel: 'Span 18h 26m',
			tripsLabel: '142 trips',
		});
		expect(span.kind).toBe('service-span');
		if (span.kind !== 'service-span') throw new Error('expected service span');
		expect(span.elapsedMin).toBe(1106);
		expect(span.domain).toEqual([0, 1440]);
		expect(span.hourTicks.map((tick) => tick.label)).toEqual([
			'+0h',
			'+6h',
			'+12h',
			'+18h',
			'+24h',
		]);
		expect(span.firstClock).toContain('Jun 25, 2026');
		expect(span.firstClock).toContain('05:12:00');
		expect(span.firstClock).toContain('GMT-4');
		expect(span.lastClock).toContain('23:38:00');
		expect(span.firstDelayMin).toBe(-1.5);
		expect(span.lastDelayMin).toBe(2);
		expect(span.spanLabel).toBe('Span 18h 26m');
		expect(span.tripsLabel).toBe('142 trips');
		expect(span.title).toBe(`Observed span from ${span.firstClock} to ${span.lastClock}`);
	});

	it.each([
		['next-day earlier clock', '2026-06-25T09:00:00Z', '2026-06-26T05:30:00Z', 1230, 1440],
		['same clock next day', '2026-06-25T09:00:00Z', '2026-06-26T09:00:00Z', 1440, 1440],
		['next-day later clock', '2026-06-25T09:00:00Z', '2026-06-26T10:00:00Z', 1500, 1800],
		['two days later', '2026-06-25T09:00:00Z', '2026-06-27T10:00:00Z', 2940, 3240],
		['spring clock jump', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', 60, 1440],
		['fall repeated clock', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', 60, 1440],
		['fall backward clock', '2026-11-01T05:45:00Z', '2026-11-01T06:15:00Z', 30, 1440],
		['spring local day', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 1380, 1440],
		['fall local day', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 1500, 1800],
		['fractional seconds', '2026-06-25T09:00:15.250Z', '2026-06-25T09:01:30.750Z', 75.5 / 60, 1440],
	] as const)('draws actual elapsed minutes for %s', (_label, first, last, minutes, end) => {
		const span = selectServiceSpan(input(first, last), 'en', opts);
		expect(span.kind).toBe('service-span');
		if (span.kind !== 'service-span') throw new Error('expected service span');
		expect(span.elapsedMin).toBeCloseTo(minutes, 10);
		expect(span.domain).toEqual([0, end]);
		expect(span.spanLabel).toBeNull();
		expect(span.hourTicks[0].min).toBe(0);
		expect(span.hourTicks.at(-1)?.min).toBe(end);
		expect(span.hourTicks.length).toBeLessThanOrEqual(5);
	});

	it('shows both dates and disambiguates repeated local clocks with their offsets', () => {
		const overnight = selectServiceSpan(
			input('2026-06-25T09:00:00Z', '2026-06-26T10:00:00Z'),
			'fr',
			opts,
		);
		if (overnight.kind !== 'service-span') throw new Error('expected service span');
		expect(overnight.firstClock).toContain('25 juin 2026');
		expect(overnight.lastClock).toContain('26 juin 2026');
		expect(overnight.lastClock).toContain('06 h 00 min 00 s UTC−4');
		const repeated = selectServiceSpan(
			input('2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'),
			'en',
			opts,
		);
		if (repeated.kind !== 'service-span') throw new Error('expected service span');
		expect(repeated.firstClock).toContain('01:30:00 GMT-4');
		expect(repeated.lastClock).toContain('01:30:00 GMT-5');
	});

	it('retains seconds while the published duration keeps its whole-minute precision', () => {
		const span = selectServiceSpan(input('2026-06-25T09:00:15Z', '2026-06-25T09:01:45Z'), 'en', {
			...opts,
			spanLabel: 'Span 2m',
		});
		if (span.kind !== 'service-span') throw new Error('expected service span');
		expect(span.elapsedMin).toBe(1.5);
		expect(span.firstClock).toContain('05:00:15');
		expect(span.lastClock).toContain('05:01:45');
		expect(span.spanLabel).toBe('Span 2m');
	});

	it('accepts equal instants expressed with different UTC offsets as a true zero', () => {
		const span = selectServiceSpan(
			input('2026-06-25T05:00:00-04:00', '2026-06-25T11:00:00+02:00'),
			'en',
			opts,
		);
		if (span.kind !== 'service-span') throw new Error('expected service span');
		expect(span.elapsedMin).toBe(0);
		expect(span.firstClock).toBe(span.lastClock);
		expect(span.domain).toEqual([0, 1440]);
	});

	it.each([
		[null, '2026-06-25T09:00:00Z'],
		['2026-06-25T09:00:00Z', null],
		[null, null],
		['', '2026-06-25T09:00:00Z'],
		['invalid', '2026-06-25T09:00:00Z'],
		['2026-06-25T09:00:00Z', 'invalid'],
		['2026-13-25T09:00:00Z', '2026-06-25T09:00:00Z'],
		['2026-06-25T09:00:00Z', '2026-06-24T09:00:00Z'],
		['2026-06-25T09:00:00', '2026-06-25T10:00:00Z'],
		['2026-06-25', '2026-06-25T10:00:00Z'],
	] as const)(
		'stands down for missing, invalid, reversed or timezone-less input: %s / %s',
		(first, last) => {
			expect(selectServiceSpan(input(first, last), 'en', opts)).toEqual({
				kind: 'absence',
				title: 'Observed service span',
				locale: 'en',
				reason: 'no-observations',
				variant: 'block',
			});
		},
	);

	it('keeps tick work bounded for an unusually long input interval', () => {
		const span = selectServiceSpan(
			input('2026-06-25T09:00:00Z', '2027-06-25T09:00:00Z'),
			'en',
			opts,
		);
		if (span.kind !== 'service-span') throw new Error('expected service span');
		expect(span.elapsedMin).toBe(365 * 1440);
		expect(span.hourTicks.length).toBeLessThanOrEqual(5);
		expect(span.hourTicks.at(-1)?.min).toBe(span.domain[1]);
	});
});
