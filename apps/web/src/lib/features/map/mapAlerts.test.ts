import { describe, expect, it } from 'vitest';
import type { Alert } from '$lib/v1/schemas';
import { buildAlertEntitySets, vehicleHasAlert } from './mapAlerts';
import type { Vehicle } from '$lib/v1/schemas';

const stopAlert: Alert = {
	id: 'stop-alert',
	severity: 'watch',
	header_key: 'Votre arrêt',
	routes: ['161'],
	stops: ['53355'],
};

describe('buildAlertEntitySets', () => {
	it('indexes alert routes and stops for map filtering', () => {
		const sets = buildAlertEntitySets([stopAlert]);

		expect(sets.routes.has('161')).toBe(true);
		expect(sets.stops.has('53355')).toBe(true);
	});
});

describe('vehicleHasAlert', () => {
	it('flags a vehicle on an alerted route or approaching an alerted stop', () => {
		const sets = buildAlertEntitySets([stopAlert]);
		expect(vehicleHasAlert({ route: '161' } as Vehicle, sets)).toBe(true);
		expect(vehicleHasAlert({ next_stop: '53355' } as Vehicle, sets)).toBe(true);
		expect(vehicleHasAlert({ route: '999', next_stop: '000' } as Vehicle, sets)).toBe(false);
	});
});
