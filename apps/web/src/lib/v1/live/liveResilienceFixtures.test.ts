import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	AlertsFileSchema,
	NetworkFileSchema,
	StopDeparturesFileSchema,
	TripsFileSchema,
	VehiclesFileSchema,
} from '$lib/v1/schemas';

const FIXTURE_ROOT = resolve(process.cwd(), 'scripts/__fixtures__/live');

const fixtures = [
	['vehicles.json', VehiclesFileSchema],
	['trips.json', TripsFileSchema],
	['stop_departures.json', StopDeparturesFileSchema],
	['alerts.json', AlertsFileSchema],
	['network.json', NetworkFileSchema],
] as const;

describe('live resilience probe fixtures', () => {
	it.each(fixtures)('%s is accepted by its production live schema', (filename, schema) => {
		const payload = JSON.parse(readFileSync(resolve(FIXTURE_ROOT, filename), 'utf8'));

		expect(schema.safeParse(payload)).toMatchObject({ success: true });
	});
});
