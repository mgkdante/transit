// entityOptions.test.ts — the PURE line/stop picker option builders (S15).

import { describe, it, expect } from 'vitest';
import type { AlertHistoryEntry } from '$lib/v1/schemas';
import { buildLineOptions, buildStopOptions } from './entityOptions';

const fold = (s: string) => s.toLowerCase();

const log: AlertHistoryEntry[] = [
	{ id: 'a', routes: ['10', '2'], stops: ['52458'] },
	{ id: 'b', routes: ['10', '24'], stops: ['99999', '52458'] },
];

describe('buildLineOptions / buildStopOptions', () => {
	it('lists DISTINCT ids numeric-aware ascending, bare id as label (no prefix)', () => {
		const lines = buildLineOptions(log, fold);
		expect(lines.map((o) => o.value)).toEqual(['2', '10', '24']);
		expect(lines[0].label).toBe('2'); // the group label carries "Line" once — no "Line 2"
	});

	it('stops are distinct + sorted; the folded search haystack is the id', () => {
		const stops = buildStopOptions(log, fold);
		expect(stops.map((o) => o.value)).toEqual(['52458', '99999']);
		expect(stops[0].search).toBe('52458');
	});

	it('empty log → empty options', () => {
		expect(buildLineOptions([], fold)).toEqual([]);
		expect(buildStopOptions([], fold)).toEqual([]);
	});
});
