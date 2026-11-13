import { describe, it, expect } from 'vitest';
import type { AlertHistoryEntry } from '#lib/v1/schemas/index.ts';
import { buildLineOptions, buildStopOptions } from './entityOptions';
import { createLineDirectory } from '#lib/site/lineDirectory.ts';

const directory = createLineDirectory(
	[
		{ id: '10', short: '10', type: 3 },
		{ id: '2', short: '2', type: 3 },
		{ id: '24', short: '24', type: 3 },
	],
	{ line: (id) => `Line ${id}` },
);
const fold = (s: string) => s.toLowerCase();

const log: AlertHistoryEntry[] = [
	{ id: 'a', routes: ['10', '2'], stops: ['52458'] },
	{ id: 'b', routes: ['10', '24'], stops: ['99999', '52458'] },
];

describe('buildLineOptions / buildStopOptions', () => {
	it('lists DISTINCT ids numeric-aware ascending, bare id as label (no prefix)', () => {
		const lines = buildLineOptions(log, fold, directory);
		expect(lines.map((o) => o.value)).toEqual(['2', '10', '24']);
		expect(lines[0].label).toBe('2');
	});

	it('stops are distinct + sorted; the folded search haystack is the id', () => {
		const stops = buildStopOptions(log, fold);
		expect(stops.map((o) => o.value)).toEqual(['52458', '99999']);
		expect(stops[0].search).toBe('52458');
	});

	it('empty log → empty options', () => {
		expect(buildLineOptions([], fold, directory)).toEqual([]);
		expect(buildStopOptions([], fold)).toEqual([]);
	});
});
it('labels line options with the directory and searches the number and name', () => {
	const directory = createLineDirectory(
		[{ id: '1-373', short: '1', long: 'Confederation', type: 1 }],
		{ line: (id) => `Line ${id}` },
	);
	expect(buildLineOptions([{ id: 'a', routes: ['1-373'] }], fold, directory)[0]).toMatchObject({
		value: '1-373',
		label: '1 · Confederation',
		search: '1-373 1 · confederation',
	});
});
