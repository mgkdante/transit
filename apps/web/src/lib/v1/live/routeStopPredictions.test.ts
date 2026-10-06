import { describe, expect, it } from 'vitest';
import { buildLiveIndex, type LiveSnapshot } from './index';
import { deriveRouteStopPredictions } from './routeStopPredictions';
import type { Trip, Vehicle } from '$lib/v1/schemas';

const ISO = '2026-06-15T12:00:00Z';

function vehicle(partial: Partial<Vehicle> & Pick<Vehicle, 'id'>): Vehicle {
	return {
		lat: 45.5,
		lon: -73.6,
		status: 'on_time',
		updated_utc: ISO,
		...partial,
	} as Vehicle;
}

interface StopEtaFixture {
	stop: string;
	eta_utc: string;
	delay_min?: number;
}

function trip(partial: { route?: string; stops: StopEtaFixture[] }): Trip {
	return {
		status: 'on_time',
		...partial,
	} as unknown as Trip;
}

function snapshot(vehicles: Vehicle[], trips: Record<string, Trip>): LiveSnapshot {
	return {
		vehicles: { generated_utc: ISO, vehicles },
		trips: { generated_utc: ISO, trips },
	} as LiveSnapshot;
}

describe('deriveRouteStopPredictions', () => {
	it('returns an empty map when no prediction or vehicle is available', () => {
		const index = buildLiveIndex({});
		expect(deriveRouteStopPredictions('161', index).size).toBe(0);
	});

	it('includes route predictions without vehicles and ignores other or unidentified routes', () => {
		const index = buildLiveIndex(
			snapshot([], {
				future: trip({ route: '161', stops: [{ stop: 'sA', eta_utc: '2026-06-15T12:05:00Z' }] }),
				other: trip({ route: '80', stops: [{ stop: 'sA', eta_utc: '2026-06-15T12:01:00Z' }] }),
				unknown: trip({ stops: [{ stop: 'sB', eta_utc: '2026-06-15T12:02:00Z' }] }),
				invalid: trip({ route: '161', stops: [{ stop: 'sC', eta_utc: 'invalid' }] }),
			}),
		);
		expect([...deriveRouteStopPredictions('161', index)]).toEqual([
			['sA', { etaUtc: '2026-06-15T12:05:00Z', delayMin: null }],
		]);
	});

	it('derives the soonest predicted arrival per stop from the route trips', () => {
		const index = buildLiveIndex(
			snapshot([vehicle({ id: 'bus1', route: '161', trip: 't1' })], {
				t1: trip({
					route: '161',
					stops: [
						{ stop: 'sA', eta_utc: '2026-06-15T12:05:00Z', delay_min: 2 },
						{ stop: 'sB', eta_utc: '2026-06-15T12:09:00Z', delay_min: 3 },
					],
				}),
			}),
		);

		const out = deriveRouteStopPredictions('161', index);
		expect(out.get('sA')).toEqual({ etaUtc: '2026-06-15T12:05:00Z', delayMin: 2 });
		expect(out.get('sB')).toEqual({ etaUtc: '2026-06-15T12:09:00Z', delayMin: 3 });
		expect(out.has('sC')).toBe(false);
	});

	it('keeps the SOONEST eta when two buses on the route predict the same stop', () => {
		const index = buildLiveIndex(
			snapshot(
				[
					vehicle({ id: 'bus1', route: '161', trip: 't1' }),
					vehicle({ id: 'bus2', route: '161', trip: 't2' }),
				],
				{
					t1: trip({ stops: [{ stop: 'sA', eta_utc: '2026-06-15T12:12:00Z', delay_min: 6 }] }),
					t2: trip({ stops: [{ stop: 'sA', eta_utc: '2026-06-15T12:04:00Z', delay_min: 1 }] }),
				},
			),
		);

		const out = deriveRouteStopPredictions('161', index);
		expect(out.get('sA')).toEqual({ etaUtc: '2026-06-15T12:04:00Z', delayMin: 1 });
	});

	it('carries a null delay through when the feed omits it', () => {
		const index = buildLiveIndex(
			snapshot([vehicle({ id: 'bus1', route: '161', trip: 't1' })], {
				t1: trip({ stops: [{ stop: 'sA', eta_utc: '2026-06-15T12:05:00Z' }] }),
			}),
		);

		expect(deriveRouteStopPredictions('161', index).get('sA')).toEqual({
			etaUtc: '2026-06-15T12:05:00Z',
			delayMin: null,
		});
	});

	it('ignores a vehicle on the route whose trip is not in the index and has no next_stop', () => {
		const index = buildLiveIndex(
			snapshot([vehicle({ id: 'bus1', route: '161', trip: 'missing' })], {}),
		);
		expect(deriveRouteStopPredictions('161', index).size).toBe(0);
	});

	it('falls back to the vehicle next_stop (no trip ETA) as an etaless approach', () => {
		const index = buildLiveIndex(
			snapshot([vehicle({ id: 'bus1', route: '161', next_stop: 'sX', delay_min: 4 })], {}),
		);
		expect(deriveRouteStopPredictions('161', index).get('sX')).toEqual({
			etaUtc: null,
			delayMin: 4,
		});
	});

	it('carries a null delay through for an etaless vehicle next_stop', () => {
		const index = buildLiveIndex(
			snapshot([vehicle({ id: 'bus1', route: '161', next_stop: 'sX' })], {}),
		);
		expect(deriveRouteStopPredictions('161', index).get('sX')).toEqual({
			etaUtc: null,
			delayMin: null,
		});
	});

	it('a precise trip ETA wins over an etaless vehicle next_stop for the same stop', () => {
		const index = buildLiveIndex(
			snapshot([vehicle({ id: 'bus1', route: '161', trip: 't1', next_stop: 'sA', delay_min: 9 })], {
				t1: trip({ stops: [{ stop: 'sA', eta_utc: '2026-06-15T12:05:00Z', delay_min: 2 }] }),
			}),
		);
		expect(deriveRouteStopPredictions('161', index).get('sA')).toEqual({
			etaUtc: '2026-06-15T12:05:00Z',
			delayMin: 2,
		});
	});
});
