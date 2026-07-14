import { describe, it, expect } from 'vitest';
import { selectCrowdingDelay, type CrowdingDelayLabels } from './crowdingDelay';
import { DELAY_POS_DOMAIN } from '$lib/features/reliability/domains';
import { OCCUPANCY_CODES } from '$lib/v1/schemas';
import type { CrowdingDelayCell } from '$lib/v1';

const labels: CrowdingDelayLabels = {
	title: 'Delay by crowding',
	rowLabel: 'Crowding band',
	xLabel: 'Avg delay',
	unit: ' min',
	bandLabel: (code) => code,
	noDataMarker: 'no data',
	noteFor: (cell) =>
		cell.p50_min != null ? `typical ${cell.p50_min} · n=${cell.observation_count ?? 0}` : undefined,
};

describe('selectCrowdingDelay', () => {
	it('emits all five occupancy bands in the fixed empty→full order on the abs domain', () => {
		const cells: CrowdingDelayCell[] = [
			{ band: 'standing', avg_delay_min: 3.3, p50_min: 2, observation_count: 50 },
		];
		const { spec, hasData } = selectCrowdingDelay(cells, 'en', labels);
		expect(hasData).toBe(true);
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		expect(spec.rows.map((r) => r.key)).toEqual([...OCCUPANCY_CODES]);
		expect(spec.domain).toEqual(DELAY_POS_DOMAIN);
		expect(spec.domain[0]).toBe(0);
		expect(spec.sort).toBe('given'); // fixed occupancy axis, never re-sorted by value
		expect(spec.rowLabel).toBe('Crowding band');
	});

	it('gives present bands a value + note, absent bands a "no data" label + reason', () => {
		const cells: CrowdingDelayCell[] = [
			{ band: 'full', avg_delay_min: 5, p50_min: 4, observation_count: 30 },
		];
		const { spec } = selectCrowdingDelay(cells, 'en', labels);
		if (spec.kind !== 'magnitude-bars') throw new Error('expected magnitude-bars');
		const full = spec.rows.find((r) => r.key === 'full');
		expect(full?.value).toBe(5);
		expect(full?.note).toContain('typical 4');
		const empty = spec.rows.find((r) => r.key === 'empty');
		expect(empty?.value).toBeNull();
		expect(empty?.label).toContain('no data');
		expect(empty?.absentReason).toBe('no-observations');
	});

	it('returns an honest-absence spec when no band has a measured delay', () => {
		const { spec, hasData } = selectCrowdingDelay(
			[{ band: 'full', avg_delay_min: null }],
			'en',
			labels,
		);
		expect(hasData).toBe(false);
		expect(spec.kind).toBe('absence');
	});
});
