import { describe, expect, it } from 'vitest';
import { buildLiveIndex, type LiveSnapshot } from './index';
import { deriveRouteStopPredictions } from './routeStopPredictions';
import type { Trip, Vehicle } from '$lib/v1/schemas';

// deriveRouteStopPredictions folds the live trips of every vehicle on a route
// into the SOONEST predicted arrival per stop. Contract under test: soonest-wins
// across buses, honest empty (no entry) for stops no live bus predicts, delay
// carried through (null when omitted), trip-not-in-index ignored.

// IsoUtc is a branded string; the snapshot files want it. Tests build plain
// objects and cast the whole snapshot (the brand is opaque, not load-bearing here).
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

/** A plain stop-ETA fixture (eta_utc is a string here; cast past the IsoUtc brand). */
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

/** Build a LiveSnapshot from plain vehicle/trip fixtures (casts past the IsoUtc brand). */
function snapshot(vehicles: Vehicle[], trips: Record<string, Trip>): LiveSnapshot {
	return {
		vehicles: { generated_utc: ISO, vehicles },
		trips: { generated_utc: ISO, trips },
	} as LiveSnapshot;
}

describe('deriveRouteStopPredictions', () => {
	it('returns an empty map when no vehicle is on the route', () => {
		const index = buildLiveIndex({});
		expect(deriveRouteStopPredictions('161', index).size).toBe(0);
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
		// A stop no live bus predicts has NO entry (honest empty, not a fake time).
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

	it('ignores a vehicle on the route whose trip is not in the index', () => {
		const index = buildLiveIndex(
			snapshot([vehicle({ id: 'bus1', route: '161', trip: 'missing' })], {}),
		);
		expect(deriveRouteStopPredictions('161', index).size).toBe(0);
	});
});
