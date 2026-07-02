import { describe, it, expect } from 'vitest';
import { selectAffectedCounts } from './affectedCounts';

const labels = {
	routes: 'Lines',
	stops: 'Stops',
	alerts: 'Alerts',
	vehicles: 'Vehicles',
	fmtCount: (v: number | null | undefined) => (v == null ? null : String(v)),
};

describe('selectAffectedCounts', () => {
	it('builds routes/stops/alerts cells and OMITS the always-null vehicles cell', () => {
		const cells = selectAffectedCounts(
			{ affected_routes: 12, affected_stops: 340, alerts: 5, vehicles: null },
			labels,
		);
		expect(cells.map((c) => c.key)).toEqual(['routes', 'stops', 'alerts']);
		expect(cells.find((c) => c.key === 'vehicles')).toBeUndefined();
	});

	it('surfaces the vehicles cell only when a real count exists', () => {
		const cells = selectAffectedCounts(
			{ affected_routes: 12, affected_stops: 340, alerts: 5, vehicles: 220 },
			labels,
		);
		expect(cells.find((c) => c.key === 'vehicles')?.value).toBe('220');
	});

	it('renders null (styled chip) for a null count, a real 0 stays 0', () => {
		const cells = selectAffectedCounts(
			{ affected_routes: null, affected_stops: 0, alerts: null, vehicles: null },
			labels,
		);
		expect(cells.find((c) => c.key === 'routes')?.value).toBeNull();
		expect(cells.find((c) => c.key === 'stops')?.value).toBe('0');
	});
});
