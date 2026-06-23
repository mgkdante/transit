import { describe, expect, it } from 'vitest';
import {
	delayKnownLabel,
	delayMaybe,
	delayTone,
	directionLabel,
	formatAge,
	isDetailMetro,
	stopDisplayName,
	timeLabel,
	vehicleForDeparture,
} from './mapSelectionDetail.logic';
import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
import type { MapSelectionDetail, MapStopRef, RouteMapDetail } from './mapSelection';
import type { StopDeparture, Vehicle } from '$lib/v1/schemas';

const en = MAP_SELECTION_DETAIL_COPY.en;

describe('isDetailMetro', () => {
	it('is false for null', () => {
		expect(isDetailMetro(null)).toBe(false);
	});
	it('reads a metro vehicle by route_type 1', () => {
		expect(isDetailMetro({ kind: 'vehicle', routeType: 1 } as MapSelectionDetail)).toBe(true);
		expect(isDetailMetro({ kind: 'vehicle', routeType: 3 } as MapSelectionDetail)).toBe(false);
	});
	it('reads a metro route by route.type 1', () => {
		expect(isDetailMetro({ kind: 'route', route: { type: 1 } } as MapSelectionDetail)).toBe(true);
		expect(isDetailMetro({ kind: 'route', route: { type: null } } as MapSelectionDetail)).toBe(
			false,
		);
	});
	it('is false for a stop', () => {
		expect(isDetailMetro({ kind: 'stop' } as MapSelectionDetail)).toBe(false);
	});
});

describe('delayMaybe — null is never on-time', () => {
	it('wraps a known delay (including 0)', () => {
		expect(delayMaybe(0)).toEqual({ known: true, value: 0 });
		expect(delayMaybe(-3)).toEqual({ known: true, value: -3 });
		expect(delayMaybe(7)).toEqual({ known: true, value: 7 });
	});
	it('absent → metro-no-realtime wins for a metro row', () => {
		const m = delayMaybe(null, { metro: true, stale: true });
		expect(m.known).toBe(false);
		if (!m.known) expect(m.reason).toBe('metro-no-realtime');
	});
	it('absent → not-reporting for a stale (GPS-quiet) vehicle', () => {
		const m = delayMaybe(undefined, { stale: true });
		expect(m.known).toBe(false);
		if (!m.known) expect(m.reason).toBe('not-reporting');
	});
	it('absent → not-reported otherwise', () => {
		const m = delayMaybe(null);
		expect(m.known).toBe(false);
		if (!m.known) expect(m.reason).toBe('not-reported');
	});
});

describe('delayKnownLabel + delayTone', () => {
	it('labels early / on-time / late', () => {
		expect(delayKnownLabel(-2, en)).toBe('2 min early');
		expect(delayKnownLabel(0, en)).toBe('On time');
		expect(delayKnownLabel(4, en)).toBe('4 min late');
	});
	it('tones map to dataviz status bands', () => {
		expect(delayTone(-1)).toBe('early');
		expect(delayTone(0)).toBe('on-time');
		expect(delayTone(2)).toBe('late');
		expect(delayTone(5)).toBe('severe');
	});
});

describe('timeLabel + formatAge', () => {
	it('empty string for a null iso', () => {
		expect(timeLabel(null, 'en')).toBe('');
		expect(timeLabel(undefined, 'en')).toBe('');
	});
	it('formats a real iso to HH:MM', () => {
		expect(timeLabel('2026-06-23T14:05:00Z', 'en')).toMatch(/\d{1,2}:\d{2}/);
	});
	it('formats age in seconds under 90, minutes above', () => {
		expect(formatAge(42)).toBe('42 s');
		expect(formatAge(120)).toBe('2 min');
	});
});

describe('stopDisplayName — never leaks a bare id', () => {
	it('returns the resolved name when present', () => {
		expect(stopDisplayName({ id: '1', name: 'Berri', nameAbsent: false } as MapStopRef, 'en')).toBe(
			'Berri',
		);
	});
	it('returns the honest labelled fallback when name is absent', () => {
		expect(
			stopDisplayName({ id: '42', name: '42', nameAbsent: true } as MapStopRef, 'en'),
		).toContain('42');
		expect(
			stopDisplayName({ id: '42', name: '42', nameAbsent: true } as MapStopRef, 'en'),
		).not.toBe('42');
	});
});

describe('vehicleForDeparture', () => {
	const vehicles = [
		{ id: 'a', trip: 't1' },
		{ id: 'b', trip: 't2' },
	] as unknown as Vehicle[];
	it('matches by trip', () => {
		expect(vehicleForDeparture(vehicles, { trip: 't2' } as StopDeparture)?.id).toBe('b');
	});
	it('null when no trip on the departure', () => {
		expect(vehicleForDeparture(vehicles, { trip: null } as unknown as StopDeparture)).toBeNull();
	});
	it('null when no vehicle matches', () => {
		expect(vehicleForDeparture(vehicles, { trip: 'tX' } as StopDeparture)).toBeNull();
	});
});

describe('directionLabel', () => {
	it('single direction → its label', () => {
		const item = { directions: [{ label: 'East' }] } as unknown as RouteMapDetail;
		expect(directionLabel(item, en)).toBe('East');
	});
	it('multiple directions → joined with a slash', () => {
		const item = {
			directions: [{ label: 'East' }, { label: 'West' }],
		} as unknown as RouteMapDetail;
		expect(directionLabel(item, en)).toBe('East / West');
	});
	it('no directions → noData', () => {
		const item = { directions: [] } as unknown as RouteMapDetail;
		expect(directionLabel(item, en)).toBe(en.noData);
	});
});
