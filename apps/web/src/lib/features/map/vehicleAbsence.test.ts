import { describe, expect, it } from 'vitest';

import { STALE_CUTOFF_S } from '$lib/components/map/vehicleProjection';
import type { Vehicle } from '$lib/v1/schemas';
import type { MapSelectionDetail } from './mapSelection';
import { vehicleAbsence } from './vehicleAbsence';

const NOW = Date.parse('2026-06-21T12:00:00Z');

/** A focused VEHICLE detail whose bus reported `ageS` seconds ago. */
function vehicleDetail(reportedAgeS: number): MapSelectionDetail {
	const reported = new Date(NOW - reportedAgeS * 1000).toISOString();
	return {
		kind: 'vehicle',
		id: 'v1',
		title: 'Bus v1',
		vehicle: {
			id: 'v1',
			lat: 45.5,
			lon: -73.6,
			status: 'on_time',
			reported_utc: reported,
			updated_utc: '2026-06-21T12:00:00Z',
		} as unknown as Vehicle,
	} as MapSelectionDetail;
}

describe('vehicleAbsence', () => {
	it('returns null for a fresh bus (fix under the cutoff)', () => {
		expect(vehicleAbsence(vehicleDetail(5), NOW)).toBeNull();
	});

	it('returns { ageS } for a bus whose own fix is past the cutoff', () => {
		const ageS = STALE_CUTOFF_S + 30;
		const note = vehicleAbsence(vehicleDetail(ageS), NOW);
		expect(note).not.toBeNull();
		expect(note?.ageS).toBeCloseTo(ageS, 0);
	});

	it('flags exactly at the cutoff (inclusive boundary)', () => {
		const note = vehicleAbsence(vehicleDetail(STALE_CUTOFF_S), NOW);
		expect(note?.ageS).toBeCloseTo(STALE_CUTOFF_S, 0);
	});

	it('returns null for a non-vehicle detail', () => {
		const stop = { kind: 'stop', id: 's1', title: 'Stop' } as unknown as MapSelectionDetail;
		expect(vehicleAbsence(stop, NOW)).toBeNull();
	});

	it('returns null for a null detail', () => {
		expect(vehicleAbsence(null, NOW)).toBeNull();
	});

	it('refreshes as the clock advances past the cutoff between polls', () => {
		const detail = vehicleDetail(STALE_CUTOFF_S - 10); // fresh now
		expect(vehicleAbsence(detail, NOW)).toBeNull();
		// 20s later the same fix is now past the cutoff → the note appears.
		expect(vehicleAbsence(detail, NOW + 20_000)).not.toBeNull();
	});
});
