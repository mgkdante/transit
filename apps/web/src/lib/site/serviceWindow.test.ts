// serviceWindow.test.ts — the pure honest-absence inference gate.
//
// Covers serviceWindowState (no-wrap + overnight-wrap + boundaries) and
// inferAbsenceReason (metro, closed, overnight, before-open, silent, last-seen,
// and the no-signal fallback to null). All deterministic — `now` is passed as
// minutes-since-midnight, never read from a clock.

import { describe, it, expect } from 'vitest';
import {
	parseWallClockMinutes,
	serviceWindowState,
	stopServiceWindow,
	inferAbsenceReason,
	ROUTE_TYPE_METRO,
	METRO_REALTIME_GAP,
} from './serviceWindow';

const hm = (h: number, m = 0) => h * 60 + m;

describe('parseWallClockMinutes', () => {
	it('parses HH:MM to minutes-since-midnight', () => {
		expect(parseWallClockMinutes('00:00')).toBe(0);
		expect(parseWallClockMinutes('05:11')).toBe(5 * 60 + 11);
		expect(parseWallClockMinutes('23:59')).toBe(23 * 60 + 59);
	});
	it('tolerates surrounding whitespace + single-digit hour', () => {
		expect(parseWallClockMinutes(' 6:30 ')).toBe(6 * 60 + 30);
	});
	it('returns null for missing / malformed / out-of-range input', () => {
		expect(parseWallClockMinutes(null)).toBeNull();
		expect(parseWallClockMinutes(undefined)).toBeNull();
		expect(parseWallClockMinutes('')).toBeNull();
		expect(parseWallClockMinutes('nope')).toBeNull();
		expect(parseWallClockMinutes('24:00')).toBeNull(); // GTFS-normalised away
		expect(parseWallClockMinutes('12:60')).toBeNull();
	});
});

describe('serviceWindowState — no-wrap window (06:00 → 23:00)', () => {
	const first = '06:00';
	const last = '23:00';
	it('before first departure → before-open', () => {
		expect(serviceWindowState(first, last, hm(5, 59))).toBe('before-open');
		expect(serviceWindowState(first, last, hm(0))).toBe('before-open');
	});
	it('inside the window → open (incl. both boundaries)', () => {
		expect(serviceWindowState(first, last, hm(6))).toBe('open'); // first boundary
		expect(serviceWindowState(first, last, hm(12))).toBe('open');
		expect(serviceWindowState(first, last, hm(23))).toBe('open'); // last boundary
	});
	it('past last departure → closed', () => {
		expect(serviceWindowState(first, last, hm(23, 1))).toBe('closed');
		expect(serviceWindowState(first, last, hm(23, 59))).toBe('closed');
	});
});

describe('serviceWindowState — overnight wrap (05:11 → 01:17)', () => {
	const first = '05:11';
	const last = '01:17';
	// The three operator-named probe times.
	it('03:00 sits in the dead gap → overnight', () => {
		expect(serviceWindowState(first, last, hm(3))).toBe('overnight');
	});
	it('23:00 is in the late-evening tail → open', () => {
		expect(serviceWindowState(first, last, hm(23))).toBe('open');
	});
	it('12:00 is mid-service → open', () => {
		expect(serviceWindowState(first, last, hm(12))).toBe('open');
	});
	it('boundaries: exactly first / exactly last → open', () => {
		expect(serviceWindowState(first, last, hm(5, 11))).toBe('open'); // first
		expect(serviceWindowState(first, last, hm(1, 17))).toBe('open'); // last (post-midnight)
	});
	it('just outside each boundary in the gap → overnight', () => {
		expect(serviceWindowState(first, last, hm(1, 18))).toBe('overnight'); // 1 min after close
		expect(serviceWindowState(first, last, hm(5, 10))).toBe('overnight'); // 1 min before open
	});
});

describe('serviceWindowState — unknown when the window cannot be parsed', () => {
	it('missing either bound → unknown (never a false "closed")', () => {
		expect(serviceWindowState(null, '23:00', hm(3))).toBe('unknown');
		expect(serviceWindowState('06:00', undefined, hm(3))).toBe('unknown');
		expect(serviceWindowState(null, null, hm(3))).toBe('unknown');
	});
	it('NaN now → unknown', () => {
		expect(serviceWindowState('06:00', '23:00', Number.NaN)).toBe('unknown');
	});
});

describe('stopServiceWindow — first/last from raw GTFS schedule times', () => {
	it('plain same-day times → first + last wall-clock', () => {
		expect(stopServiceWindow(['07:00:00', '12:30:00', '23:00:00'])).toEqual({
			first: '07:00',
			last: '23:00',
		});
	});
	it('tolerates HH:MM (no seconds)', () => {
		expect(stopServiceWindow(['06:15', '22:45'])).toEqual({ first: '06:15', last: '22:45' });
	});
	it('past-midnight GTFS time (>=24:00) folds + wraps the window', () => {
		// last = 25:30 → 01:30 next day; window wraps (last < first).
		const w = stopServiceWindow(['05:11:00', '25:30:00']);
		expect(w).toEqual({ first: '05:11', last: '01:30' });
		// And the wrapped window reads 'overnight' at 03:00, 'open' at 12:00.
		expect(serviceWindowState(w!.first, w!.last, hm(3))).toBe('overnight');
		expect(serviceWindowState(w!.first, w!.last, hm(12))).toBe('open');
	});
	it('returns null when nothing parses / no times', () => {
		expect(stopServiceWindow([])).toBeNull();
		expect(stopServiceWindow(null)).toBeNull();
		expect(stopServiceWindow(undefined)).toBeNull();
		expect(stopServiceWindow(['nope', 'also:bad'])).toBeNull();
	});
});

describe('inferAbsenceReason — metro has no realtime', () => {
	it('route_type 1 + metro_realtime gap → metro-no-realtime', () => {
		expect(inferAbsenceReason({ routeType: ROUTE_TYPE_METRO, gaps: [METRO_REALTIME_GAP] })).toEqual(
			{ key: 'metro-no-realtime' },
		);
	});
	it('metro route WITHOUT the gap → not metro (no over-claim)', () => {
		expect(inferAbsenceReason({ routeType: ROUTE_TYPE_METRO, gaps: [] })).toBeNull();
	});
	it('the gap present but a BUS route → not metro', () => {
		expect(inferAbsenceReason({ routeType: 3, gaps: [METRO_REALTIME_GAP] })).toBeNull();
	});
	it('metro reason wins over a window signal', () => {
		expect(
			inferAbsenceReason({
				routeType: ROUTE_TYPE_METRO,
				gaps: [METRO_REALTIME_GAP],
				firstDeparture: '05:30',
				lastDeparture: '01:00',
				nowMinutes: hm(3),
			}),
		).toEqual({ key: 'metro-no-realtime' });
	});
});

describe('inferAbsenceReason — service window', () => {
	it('past close on a same-day window → closed-opens-at with FIRST', () => {
		expect(
			inferAbsenceReason({
				firstDeparture: '06:00',
				lastDeparture: '23:00',
				nowMinutes: hm(23, 30),
			}),
		).toEqual({ key: 'closed-opens-at', firstDeparture: '06:00' });
	});
	it('overnight dead gap → overnight-opens-at with FIRST', () => {
		expect(
			inferAbsenceReason({
				firstDeparture: '05:11',
				lastDeparture: '01:17',
				nowMinutes: hm(3),
			}),
		).toEqual({ key: 'overnight-opens-at', firstDeparture: '05:11' });
	});
	it('before first departure → before-open with FIRST', () => {
		expect(
			inferAbsenceReason({
				firstDeparture: '06:00',
				lastDeparture: '23:00',
				nowMinutes: hm(5),
			}),
		).toEqual({ key: 'before-open', firstDeparture: '06:00' });
	});
	it('open + non-responding → scheduled-silent', () => {
		expect(
			inferAbsenceReason({
				firstDeparture: '06:00',
				lastDeparture: '23:00',
				nowMinutes: hm(12),
				nonResponding: true,
			}),
		).toEqual({ key: 'scheduled-silent' });
	});
	it('open but NO non-responding signal → null (no over-claim of "silent")', () => {
		expect(
			inferAbsenceReason({
				firstDeparture: '06:00',
				lastDeparture: '23:00',
				nowMinutes: hm(12),
			}),
		).toBeNull();
	});
});

describe('inferAbsenceReason — last-seen (selected silent vehicle, map)', () => {
	it('carries the last-report ISO through', () => {
		expect(inferAbsenceReason({ lastSeenIso: '2026-06-21T03:14:00Z' })).toEqual({
			key: 'last-seen',
			lastSeenIso: '2026-06-21T03:14:00Z',
		});
	});
	it('an empty last-seen string is ignored', () => {
		expect(inferAbsenceReason({ lastSeenIso: '' })).toBeNull();
	});
});

describe('inferAbsenceReason — no derivable signal falls back to null', () => {
	it('empty signals → null', () => {
		expect(inferAbsenceReason({})).toBeNull();
	});
	it('a window that cannot be parsed → null (caller shows plain no-data)', () => {
		expect(
			inferAbsenceReason({ firstDeparture: null, lastDeparture: null, nowMinutes: hm(3) }),
		).toBeNull();
	});
	it('a window with no clock → null', () => {
		expect(
			inferAbsenceReason({ firstDeparture: '06:00', lastDeparture: '23:00', nowMinutes: null }),
		).toBeNull();
	});
});
