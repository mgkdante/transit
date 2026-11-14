import { describe, expect, it } from 'vitest';
import { formatClock, formatLocalClock } from './time';

const at = (iso: string) => new Date(iso);

describe('formatLocalClock', () => {
	it.each([
		['2026-07-14T23:21:00Z', 'America/Toronto', '7:21 p.m.', '19 h 21'],
		['2026-07-14T23:21:00Z', 'America/Vancouver', '4:21 p.m.', '16 h 21'],
		['2026-11-14T17:00:00Z', 'America/Toronto', '12:00 p.m.', '12 h 00'],
		['2026-11-14T05:00:00Z', 'America/Toronto', '12:00 a.m.', '0 h 00'],
		['2026-03-08T06:59:00Z', 'America/Toronto', '1:59 a.m.', '1 h 59'],
		['2026-03-08T07:00:00Z', 'America/Toronto', '3:00 a.m.', '3 h 00'],
	])('reads %s in %s as %s and %s', (iso, zone, en, fr) => {
		expect(formatLocalClock(at(iso), 'en', zone)).toBe(en);
		expect(formatLocalClock(at(iso), 'fr', zone)).toBe(fr);
	});

	it('uses the host zone when no network zone is given', () => {
		const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const date = at('2026-07-14T23:21:00Z');
		expect(formatLocalClock(date, 'fr')).toBe(formatLocalClock(date, 'fr', host));
	});

	it('shows a dot for an invalid date and refuses an unknown zone', () => {
		expect(formatLocalClock(at('not a date'), 'en', 'America/Toronto')).toBe('·');
		expect(() => formatLocalClock(at('2026-07-14T23:21:00Z'), 'en', 'Not/AZone')).toThrow(
			RangeError,
		);
	});

	it('leaves the machine clock as parseable 24-hour HH:mm', () => {
		expect(formatClock(at('2026-07-14T23:21:00Z'), 'en')).toBe('19:21');
		expect(formatClock(at('2026-11-14T05:00:00Z'), 'fr')).toBe('00:00');
	});
});
