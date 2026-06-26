import { describe, it, expect } from 'vitest';
import { selectHeadwayDumbbell, type HeadwayDumbbellLabels } from './headwayDumbbell';
import { HEADWAY_DOMAIN } from '$lib/features/reliability/domains';

const labels: HeadwayDumbbellLabels = {
	title: 'Headway by shift',
	xLabel: 'Headway',
	unit: ' min',
	scheduledLabel: 'Scheduled',
	observedLabel: 'Observed',
	noDataMarker: 'no data',
};

describe('selectHeadwayDumbbell', () => {
	it('builds a dumbbell on the fixed HEADWAY_DOMAIN with both endpoints + the gap', () => {
		const { spec, hasData } = selectHeadwayDumbbell(
			[
				{ key: 'am', label: 'AM peak', scheduled: 8, observed: 13, excess: 2.5, severity: 'high' },
				{ key: 'pm', label: 'PM peak', scheduled: 9, observed: 10, excess: 0.5, severity: 'watch' },
			],
			'en',
			labels,
		);
		expect(hasData).toBe(true);
		if (spec.kind !== 'dumbbell') throw new Error('expected dumbbell');
		expect(spec.domain).toEqual(HEADWAY_DOMAIN);
		expect(spec.domain[0]).toBe(0); // zero-based, never /max
		expect(spec.scale).toBe('severity');
		const am = spec.rows.find((r) => r.key === 'am');
		expect(am?.scheduled).toBe(8);
		expect(am?.observed).toBe(13);
		expect(am?.excess).toBe(2.5);
		expect(am?.severity).toBe('high');
	});

	it('marks a row missing an endpoint "no data" (never a fabricated bar)', () => {
		const { spec } = selectHeadwayDumbbell(
			[
				{ key: 'am', label: 'AM peak', scheduled: 8, observed: 13, excess: 2.5 },
				{ key: 'night', label: 'Night', scheduled: 20, observed: null, excess: null },
			],
			'en',
			labels,
		);
		if (spec.kind !== 'dumbbell') throw new Error('expected dumbbell');
		const night = spec.rows.find((r) => r.key === 'night');
		expect(night?.observed).toBeNull();
		expect(night?.label).toContain('no data');
		expect(night?.absentReason).toBe('no-observations');
	});

	it('returns an honest-absence spec when no shift has both endpoints', () => {
		const { spec, hasData } = selectHeadwayDumbbell(
			[{ key: 'am', label: 'AM peak', scheduled: 8, observed: null, excess: null }],
			'en',
			labels,
		);
		expect(hasData).toBe(false);
		expect(spec.kind).toBe('absence');
	});
});
