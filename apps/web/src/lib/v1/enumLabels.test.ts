// enumLabels.test.ts — the display vocabulary must cover the closed enums EXACTLY,
// in BOTH locales, with no missing/extra code. Catches future enum drift (a new
// StatusCode/OccupancyCode option added to the schema without a label) at test time.

import { describe, expect, it } from 'vitest';
import { StatusCodeSchema, OccupancyCodeSchema } from './schemas';
import { STATUS_LABELS, OCCUPANCY_LABELS } from './enumLabels';

const LOCALES = ['en', 'fr'] as const;

describe('enumLabels — one bilingual vocabulary, exact enum coverage', () => {
	it('STATUS_LABELS keys === StatusCodeSchema.options for every locale', () => {
		const codes = [...StatusCodeSchema.options].sort();
		for (const loc of LOCALES) {
			expect(Object.keys(STATUS_LABELS[loc]).sort()).toEqual(codes);
		}
	});

	it('OCCUPANCY_LABELS keys === OccupancyCodeSchema.options for every locale', () => {
		const codes = [...OccupancyCodeSchema.options].sort();
		for (const loc of LOCALES) {
			expect(Object.keys(OCCUPANCY_LABELS[loc]).sort()).toEqual(codes);
		}
	});

	it('every label is a non-empty string', () => {
		for (const loc of LOCALES) {
			for (const v of [
				...Object.values(STATUS_LABELS[loc]),
				...Object.values(OCCUPANCY_LABELS[loc]),
			]) {
				expect(v.trim().length).toBeGreaterThan(0);
			}
		}
	});
});
